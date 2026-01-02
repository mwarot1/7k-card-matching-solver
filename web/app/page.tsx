'use client';

import { useState, useRef, useEffect } from 'react';

interface SolveResult {
  session_id: string;
  pairs_count: number;
  pairs: number[][];
  grid_faces: Record<string, string | null>;
  status: string;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [streamActive, setStreamActive] = useState(false);
  const [duration, setDuration] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Stop timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const initCapture = async () => {
    try {
      setError(null);
      setResult(null);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      setStreamActive(true);

      // Handle stream end (user clicks "Stop Sharing")
      stream.getVideoTracks()[0].onended = () => {
        stopRecording();
        setStreamActive(false);
      };

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to capture screen');
    }
  };

  const startRecording = () => {
    if (!streamRef.current) return;

    try {
      const recorder = new MediaRecorder(streamRef.current, { mimeType: 'video/webm;codecs=vp8' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        handleUpload(blob);
      };

      recorder.start();
      setIsRecording(true);
      setDuration(0);

      timerRef.current = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);

    } catch (err) {
      setError('Recording failed to start');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    setIsRecording(false);
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopCapture = () => {
    stopRecording();
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreamActive(false);
  };

  const handleUpload = async (videoBlob: Blob) => {
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', videoBlob, 'capture.webm');

    try {
      const response = await fetch(`${API_BASE_URL}/solve`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to solve video');
      }

      const data: SolveResult = await response.json();
      console.log('DEBUG: Received data from API:', {
        pairs_count: data.pairs_count,
        has_grid_faces: !!data.grid_faces,
        grid_faces_count: data.grid_faces ? Object.keys(data.grid_faces).length : 0,
        populated_faces: data.grid_faces ? Object.values(data.grid_faces).filter(v => !!v).length : 0
      });
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during solving');
    } finally {
      setLoading(false);
    }
  };

  // Helper to map 0-23 indices to an 8x3 grid representation
  const renderGrid = () => {
    if (!result) return null;

    // Create a flat array of 24 cards
    const cardMap = new Array(24).fill(null);
    if (result.pairs) {
      result.pairs.forEach((pair, pairIdx) => {
        if (pair && pair.length >= 2) {
          cardMap[Number(pair[0])] = pairIdx + 1;
          cardMap[Number(pair[1])] = pairIdx + 1;
        }
      });
    }

    const faces = result.grid_faces || {};

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginTop: '2rem' }}>
        <div className="grid" style={{
          gridTemplateColumns: 'repeat(8, 1fr)',
          maxWidth: '850px',
          width: '100%',
          margin: '0 auto',
          gap: '0.75rem'
        }}>
          {cardMap.map((pairNum, cardIdx) => {
            const faceUrl = faces[cardIdx.toString()];
            return (
              <div
                key={cardIdx}
                className={`card-item ${pairNum ? 'matched' : ''}`}
                style={{
                  border: pairNum ? '2px solid var(--primary)' : '1px solid var(--glass-border)',
                  boxShadow: pairNum ? '0 0 10px var(--primary-glow)' : 'none'
                }}
              >
                {faceUrl ? (
                  <img src={faceUrl} alt={`Card ${cardIdx}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    background: 'rgba(255,255,255,0.05)'
                  }}>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <main className="main">
      <div className="container">
        <header className="header">
          <h1 className="title">มินิเกมส์ เทพเจ้าดอจ</h1>
          <p className="subtitle">สำหรับเหล่าลิงที่ขี้เกียจจำ</p>
        </header>

        <section className="glass-card">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}>

            {/* Live Preview / Status */}
            <div style={{
              width: '100%',
              aspectRatio: '16/9',
              background: 'rgba(0,0,0,0.3)',
              borderRadius: '1rem',
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              position: 'relative',
              border: '1px solid var(--glass-border)'
            }}>
              <video
                ref={videoRef}
                autoPlay
                muted
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: streamActive ? 'block' : 'none' }}
              />
              {!streamActive && !loading && (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <p style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>Ready to capture your game window</p>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
                    Select the window where the game is running
                  </p>
                </div>
              )}
              {isRecording && (
                <div style={{
                  position: 'absolute',
                  top: '1rem',
                  right: '1rem',
                  background: 'rgba(239, 68, 68, 0.8)',
                  padding: '0.5rem 1rem',
                  borderRadius: '2rem',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  zIndex: 20
                }}>
                  <div className="record-dot"></div>
                  RECORDING: {duration}s
                </div>
              )}
              {loading && (
                <div style={{ textAlign: 'center', position: 'absolute', zIndex: 10 }}>
                  <div className="spinner" style={{ width: '40px', height: '40px', marginBottom: '1rem' }}></div>
                  <p style={{ fontWeight: 600, textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>Analyzing patterns...</p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {!streamActive ? (
                <button className="button" onClick={initCapture} disabled={loading}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                  Select Game Window
                </button>
              ) : (
                <>
                  <button
                    className="button"
                    onClick={isRecording ? stopRecording : startRecording}
                    disabled={loading}
                    style={{ background: isRecording ? '#ef4444' : 'var(--primary)' }}
                  >
                    {isRecording ? (
                      <><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg> Stop Recording</>
                    ) : (
                      <><svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="6"></circle></svg> Start Recording</>
                    )}
                  </button>
                  <button className="button" style={{ background: '#334155' }} onClick={stopCapture} disabled={isRecording || loading}>
                    Cancel
                  </button>
                </>
              )}
            </div>

            <style jsx>{`
              .record-dot {
                width: 8px;
                height: 8px;
                background: white;
                border-radius: 50%;
                animation: pulse 1s infinite;
              }
              @keyframes pulse {
                0% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(1.2); }
                100% { opacity: 1; transform: scale(1); }
              }
            `}</style>

            {error && (
              <div style={{ color: '#f87171', textAlign: 'center', background: 'rgba(248, 113, 113, 0.1)', padding: '1rem', borderRadius: '0.5rem', width: '100%' }}>
                <strong>Error:</strong> {error}
              </div>
            )}
          </div>
        </section>

        {result && (
          <section className="glass-card" style={{ marginTop: '2rem' }}>
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', color: 'var(--secondary)', textAlign: 'center' }}>
              ผลลัพธ์
            </h2>
            {renderGrid()}
          </section>
        )}
      </div>
    </main>
  );
}
