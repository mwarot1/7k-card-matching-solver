'use client';

import { useState, useRef } from 'react';

interface SolveResult {
  session_id: string;
  pairs_count: number;
  pairs: [number, number][];
  status: string;
}

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const startCapture = async () => {
    try {
      setError(null);
      setResult(null);

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" } as any,
        audio: false
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
        if (videoRef.current) videoRef.current.srcObject = null;

        // Send to backend
        handleUpload(blob);
      };

      // Start recording
      setIsRecording(true);
      recorder.start();

      // Countdown for 8 seconds
      let timeLeft = 8;
      setCountdown(timeLeft);
      const interval = setInterval(() => {
        timeLeft -= 1;
        setCountdown(timeLeft);
        if (timeLeft <= 0) {
          clearInterval(interval);
          recorder.stop();
          setIsRecording(false);
          setCountdown(null);
        }
      }, 1000);

    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to capture screen');
      setIsRecording(false);
    }
  };

  const handleUpload = async (videoBlob: Blob) => {
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', videoBlob, 'capture.webm');

    try {
      const response = await fetch('http://localhost:8000/solve', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || 'Failed to solve video');
      }

      const data: SolveResult = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred during solving');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="main">
      <div className="container">
        <header className="header">
          <h1 className="title">CardSolverV3</h1>
          <p className="subtitle">Live Window Capture & AI Matching Solver</p>
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
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: isRecording ? 'block' : 'none' }}
              />
              {!isRecording && !loading && (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <p style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>Ready to capture your game window</p>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
                    Ensure the game is visible before starting
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
                  fontSize: '0.9rem'
                }}>
                  <div style={{ width: '8px', height: '8px', background: 'white', borderRadius: '50%', animation: 'pulse 1s infinite' }}></div>
                  RECORDING: {countdown}s
                </div>
              )}
              {loading && (
                <div style={{ textAlign: 'center' }}>
                  <div className="spinner" style={{ width: '40px', height: '40px', marginBottom: '1rem' }}></div>
                  <p style={{ fontWeight: 600 }}>Analyzing patterns...</p>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: '1rem' }}>
              <button
                className="button"
                onClick={startCapture}
                disabled={isRecording || loading}
                style={{ padding: '1rem 2rem', fontSize: '1.1rem' }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
                {isRecording ? 'Capturing...' : 'Capture Game Window'}
              </button>
            </div>

            <style jsx>{`
              @keyframes pulse {
                0% { opacity: 1; }
                50% { opacity: 0.5; }
                100% { opacity: 1; }
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
            <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', color: 'var(--secondary)' }}>
              Solution Found: {result.pairs_count} Pairs
            </h2>
            <div className="grid">
              {result.pairs.map((pair, idx) => (
                <div key={idx} style={{ display: 'contents' }}>
                  <div className="card-item matched">
                    <div className="pair-badge">{idx + 1}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                      Card {pair[0]}
                    </div>
                  </div>
                  <div className="card-item matched">
                    <div className="pair-badge">{idx + 1}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                      Card {pair[1]}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
