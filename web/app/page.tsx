'use client';

import { useState, useRef, useEffect } from 'react';
import { ClientSideSolver, SolveResult as ClientSolveResult } from '../utils/solver';

interface SolveResult {
  session_id?: string;
  pairs_count: number;
  pairs: number[][];
  grid_faces: Record<string, string | null>;
  status: string;
  cards_detected?: number;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [streamActive, setStreamActive] = useState(false);
  const [duration, setDuration] = useState(0);
  const [progress, setProgress] = useState<{current: number, total: number, stage: string, stepHistory?: Array<{step: string, duration: number}>} | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const solverRef = useRef<ClientSideSolver | null>(null);

  // Initialize solver
  useEffect(() => {
    const solver = new ClientSideSolver((current, total, stage, stepHistory) => {
      setProgress({current, total, stage, stepHistory});
    });
    // Wait for OpenCV to be ready
    const checkCV = setInterval(() => {
      if (window.cv && window.cv.Mat) {
        clearInterval(checkCV);
        solver.init('/7k-card-matching-solver/templates/BackCard.png').then(() => {
          solverRef.current = solver;
          console.log('Solver initialized');
        }).catch(err => {
          console.error('Failed to initialize solver:', err);
          setError('Failed to initialize solver');
        });
      }
    }, 500);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      clearInterval(checkCV);
      if (solverRef.current) solverRef.current.dispose();
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
    if (!solverRef.current) {
      setError('Solver not initialized. Please wait for OpenCV to load.');
      return;
    }

    setLoading(true);
    setError(null);
    setProgress({current: 0, total: 100, stage: 'Preparing...', stepHistory: []});

    try {
      const data = await solverRef.current.solve(videoBlob);
      setResult(data as SolveResult);
      // Keep step history visible after completion
      if (data.step_history) {
        setProgress({current: 100, total: 100, stage: 'Complete', stepHistory: data.step_history});
      }
    } catch (err) {
      console.error('Solve error:', err);
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
        {/* Floating Guide Panel */}
        <div style={{
          position: 'fixed',
          top: '1rem',
          left: '1rem',
          zIndex: 1000,
          maxWidth: '350px'
        }}>
          <button
            onClick={() => setShowGuide(!showGuide)}
            style={{
              background: 'rgba(59, 130, 246, 0.9)',
              border: 'none',
              borderRadius: '50%',
              width: '48px',
              height: '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
              transition: 'all 0.3s ease',
              color: 'white',
              fontSize: '1.5rem',
              fontWeight: 'bold'
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.1)';
              e.currentTarget.style.background = 'rgba(59, 130, 246, 1)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)';
              e.currentTarget.style.background = 'rgba(59, 130, 246, 0.9)';
            }}
          >
            ?
          </button>
          
          {showGuide && (
            <div style={{
              marginTop: '0.5rem',
              background: 'rgba(15, 23, 42, 0.95)',
              backdropFilter: 'blur(10px)',
              border: '1px solid rgba(59, 130, 246, 0.3)',
              borderRadius: '1rem',
              padding: '1.5rem',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
              animation: 'slideIn 0.3s ease'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <h3 style={{ color: '#3b82f6', fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>📖 How to Use</h3>
                <button
                  onClick={() => setShowGuide(false)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.6)',
                    fontSize: '1.5rem',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1
                  }}
                >
                  ×
                </button>
              </div>
              
              <ol style={{ 
                margin: 0, 
                paddingLeft: '1.5rem',
                color: 'rgba(255, 255, 255, 0.9)',
                fontSize: '0.9rem',
                lineHeight: '1.8'
              }}>
                <li style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ color: '#60a5fa' }}>Select Game Window</strong>
                  <br />
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                    Click the button and choose your game window
                  </span>
                </li>
                <li style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ color: '#60a5fa' }}>Position the View</strong>
                  <br />
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                    Make sure all 24 cards (8×3 grid) are visible
                  </span>
                </li>
                <li style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ color: '#60a5fa' }}>Start Recording</strong>
                  <br />
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                    Begin recording before you start playing
                  </span>
                </li>
                <li style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ color: '#60a5fa' }}>Play the Game</strong>
                  <br />
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                    Reveal all cards naturally during gameplay
                  </span>
                </li>
                <li style={{ marginBottom: '0.75rem' }}>
                  <strong style={{ color: '#60a5fa' }}>Stop Recording</strong>
                  <br />
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                    Once all cards are revealed, stop the recording
                  </span>
                </li>
                <li>
                  <strong style={{ color: '#60a5fa' }}>Wait for Results</strong>
                  <br />
                  <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                    The solver will analyze and show matching pairs
                  </span>
                </li>
              </ol>
              
              <div style={{
                marginTop: '1rem',
                padding: '0.75rem',
                background: 'rgba(59, 130, 246, 0.1)',
                borderRadius: '0.5rem',
                border: '1px solid rgba(59, 130, 246, 0.3)'
              }}>
                <p style={{ 
                  margin: 0, 
                  fontSize: '0.8rem', 
                  color: 'rgba(147, 197, 253, 0.9)',
                  lineHeight: '1.5'
                }}>
                  💡 <strong>Tip:</strong> Record for at least 20-30 seconds to ensure all cards are captured clearly.
                </p>
              </div>
            </div>
          )}
        </div>
        
        <style jsx>{`
          @keyframes slideIn {
            from {
              opacity: 0;
              transform: translateY(-10px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>

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
            </div>

            {/* Large Progress Bar Below Video */}
            {progress && (
              <div style={{ width: '100%', marginTop: '1.5rem' }}>
                <div style={{ 
                  background: 'rgba(0,0,0,0.8)', 
                  borderRadius: '1.5rem', 
                  overflow: 'hidden',
                  marginBottom: '1rem',
                  border: '2px solid rgba(0,0,0,0.5)',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.5)'
                }}>
                  <div style={{ 
                    height: '24px', 
                    background: 'linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899)',
                    width: `${Math.min((progress.current / progress.total) * 100, 100)}%`,
                    transition: 'width 0.3s ease',
                    borderRadius: '1.5rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    paddingRight: '1rem',
                    position: 'relative',
                    overflow: 'hidden',
                    boxShadow: '0 0 20px rgba(139, 92, 246, 0.6)'
                  }}>
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                      animation: 'shimmer 2s infinite'
                    }} />
                    <span style={{ 
                      fontSize: '0.85rem', 
                      fontWeight: 700, 
                      color: 'white',
                      textShadow: '0 2px 4px rgba(0,0,0,0.8)',
                      position: 'relative',
                      zIndex: 1
                    }}>
                      {Math.round((progress.current / progress.total) * 100)}%
                    </span>
                  </div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <p style={{ 
                    fontSize: '1.1rem', 
                    fontWeight: 600, 
                    color: 'var(--text)',
                    marginBottom: '0.25rem'
                  }}>
                    {progress.stage}
                  </p>
                  <p style={{ fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                    {progress.current} / {progress.total} frames
                  </p>
                </div>
                
                {/* Step History and Upcoming Steps */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', marginTop: '1.5rem' }}>
                  {['Extract frames', 'Detect cards', 'Find baseline', 'Extract faces', 'Match pairs'].map((stepName, idx) => {
                    const completed = progress.stepHistory?.find(s => s.step === stepName);
                    const isCurrent = progress.stage.toLowerCase().includes(stepName.toLowerCase().split(' ')[1] || stepName.toLowerCase());
                    const isPending = !completed && !isCurrent;
                    
                    return (
                      <div key={idx} style={{
                        padding: '0.75rem',
                        borderRadius: '0.5rem',
                        background: completed ? 'rgba(34, 197, 94, 0.1)' : isCurrent ? 'rgba(59, 130, 246, 0.1)' : 'rgba(100, 116, 139, 0.05)',
                        border: `1px solid ${completed ? 'rgba(34, 197, 94, 0.3)' : isCurrent ? 'rgba(59, 130, 246, 0.3)' : 'rgba(100, 116, 139, 0.1)'}`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem'
                      }}>
                        <div style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '50%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: completed ? '#22c55e' : isCurrent ? '#3b82f6' : 'rgba(100, 116, 139, 0.2)',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: 'white',
                          flexShrink: 0
                        }}>
                          {completed ? '✓' : isCurrent ? '...' : idx + 1}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ 
                            fontSize: '0.85rem', 
                            fontWeight: 600,
                            color: completed ? '#22c55e' : isCurrent ? '#3b82f6' : 'var(--text-dim)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis'
                          }}>
                            {stepName}
                          </div>
                          {completed && (
                            <div style={{ fontSize: '0.7rem', color: 'rgba(34, 197, 94, 0.7)' }}>
                              {(completed.duration / 1000).toFixed(1)}s
                            </div>
                          )}
                          {isCurrent && (
                            <div style={{ fontSize: '0.7rem', color: 'rgba(59, 130, 246, 0.7)' }}>
                              In progress...
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <style jsx>{`
              @keyframes shimmer {
                0% { transform: translateX(-100%); }
                100% { transform: translateX(100%); }
              }
            `}</style>

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
          <>
            {result.cards_detected !== undefined && result.cards_detected !== 24 && (
              <section className="glass-card" style={{ marginTop: '2rem', background: 'rgba(234, 179, 8, 0.1)', border: '1px solid rgba(234, 179, 8, 0.3)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#eab308" strokeWidth="2" style={{ flexShrink: 0, marginTop: '2px' }}>
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
                    <line x1="12" y1="9" x2="12" y2="13"></line>
                    <line x1="12" y1="17" x2="12.01" y2="17"></line>
                  </svg>
                  <div>
                    <h3 style={{ color: '#eab308', marginBottom: '0.5rem', fontSize: '1.1rem', fontWeight: 600 }}>⚠️ Incomplete Grid Detection</h3>
                    <p style={{ color: 'rgba(234, 179, 8, 0.9)', fontSize: '0.95rem', lineHeight: '1.5' }}>
                      Only detected <strong>{result.cards_detected} cards</strong> instead of the expected 24 cards.
                      This may result in incomplete or inaccurate pair matching.
                    </p>
                    <p style={{ color: 'rgba(234, 179, 8, 0.7)', fontSize: '0.85rem', marginTop: '0.5rem', fontStyle: 'italic' }}>
                      💡 Tips: Ensure the entire grid is visible, adjust lighting, or try recording from a clearer angle.
                    </p>
                  </div>
                </div>
              </section>
            )}
            
            <section className="glass-card" style={{ marginTop: '2rem' }}>
              <h2 style={{ marginBottom: '1.5rem', fontSize: '1.5rem', color: 'var(--secondary)', textAlign: 'center' }}>
                ผลลัพธ์
              </h2>
              {renderGrid()}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
