'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { ClientSideSolver, SolveResult as ClientSolveResult } from '../../utils/solver';
import guideConfig from '../../config/guide.json';

interface SolveResult {
  session_id?: string;
  pairs_count: number;
  card_assignments: Record<number, {cardType: number, confidence: number} | null>;
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
  const [showGuide, setShowGuide] = useState(true);
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [rangeStart, setRangeStart] = useState<number>(0);
  const [rangeEnd, setRangeEnd] = useState<number>(0);
  const [currentTime, setCurrentTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [showCardLabels, setShowCardLabels] = useState<boolean>(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const uploadVideoRef = useRef<HTMLVideoElement>(null);
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
        solver.init('/templates/BackCard.png').then(() => {
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
        // Convert recorded blob to File and treat it like an uploaded video
        const file = new File([blob], 'screen-recording.webm', { type: 'video/webm' });
        setUploadedVideo(file);
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
        setError(null);
        setResult(null);
        // Stop the capture stream
        stopCapture();
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

  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('video/')) {
      setUploadedVideo(file);
      const url = URL.createObjectURL(file);
      setVideoUrl(url);
      setError(null);
      setResult(null);
    } else {
      setError('Please select a valid video file');
    }
  };

  const handleVideoLoaded = () => {
    if (uploadVideoRef.current) {
      const duration = uploadVideoRef.current.duration;
      setVideoDuration(duration);
      setRangeEnd(duration);
    }
  };

  const handlePlayPause = () => {
    if (uploadVideoRef.current) {
      if (isPlaying) {
        uploadVideoRef.current.pause();
        setIsPlaying(false);
      } else {
        // Start playing from range start if not in range
        if (uploadVideoRef.current.currentTime < rangeStart || uploadVideoRef.current.currentTime > rangeEnd) {
          uploadVideoRef.current.currentTime = rangeStart;
        }
        uploadVideoRef.current.play();
        setIsPlaying(true);
      }
    }
  };

  const handleTimeUpdate = () => {
    if (uploadVideoRef.current) {
      const time = uploadVideoRef.current.currentTime;
      setCurrentTime(time);
      
      // Loop within range when playing
      if (isPlaying && time >= rangeEnd) {
        uploadVideoRef.current.currentTime = rangeStart;
      }
    }
  };

  const seekTo = (time: number) => {
    if (uploadVideoRef.current) {
      uploadVideoRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };

  // Update frame previews when range changes
  useEffect(() => {
    if (!uploadVideoRef.current || !uploadedVideo) return;

    const video = uploadVideoRef.current;
    
    // Debounce to avoid conflicts with slider seeking
    const timeoutId = setTimeout(() => {
      if (!video || video.readyState < 1) return;

      // Capture frames without affecting main video playback
      const captureFrame = (time: number, canvasId: string) => {
        const tempVideo = document.createElement('video');
        tempVideo.src = videoUrl || '';
        tempVideo.currentTime = time;
        
        tempVideo.onseeked = () => {
          const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
          if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
              canvas.width = tempVideo.videoWidth;
              canvas.height = tempVideo.videoHeight;
              ctx.drawImage(tempVideo, 0, 0);
            }
          }
          tempVideo.remove();
        };
      };

      captureFrame(rangeStart, 'start-frame-canvas');
      captureFrame(rangeEnd, 'end-frame-canvas');
    }, 500); // Debounce 500ms

    return () => clearTimeout(timeoutId);
  }, [rangeStart, rangeEnd, uploadedVideo, videoUrl]);

  const extractVideoSegment = useCallback(async () => {
    if (!uploadedVideo || !solverRef.current) return;
    
    console.log(`extractVideoSegment called with rangeStart=${rangeStart}, rangeEnd=${rangeEnd}`);
    
    setLoading(true);
    setError(null);
    setProgress({current: 0, total: 100, stage: 'Preparing...', stepHistory: []});

    try {
      console.log(`Calling solve(uploadedVideo, ${rangeStart}, ${rangeEnd})`);
      const data = await solverRef.current.solve(uploadedVideo, rangeStart, rangeEnd);
      setResult(data as SolveResult);
      if (data.step_history) {
        setProgress({current: 100, total: 100, stage: 'Complete', stepHistory: data.step_history});
      }
    } catch (err) {
      console.error('Solve error:', err);
      setError(err instanceof Error ? err.message : 'Failed to process video');
    } finally {
      setLoading(false);
    }
  }, [uploadedVideo, rangeStart, rangeEnd]);

  // Helper to render card grid with assigned types
  const renderGrid = () => {
    if (!result) return null;

    const faces = result.grid_faces || {};
    const assignments = result.card_assignments || {};

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '100%', marginTop: '2rem' }}>
        <div className="grid" style={{
          gridTemplateColumns: 'repeat(8, 1fr)',
          maxWidth: '850px',
          width: '100%',
          margin: '0 auto',
          gap: '0.75rem'
        }}>
          {Array.from({length: 24}, (_, cardIdx) => {
            const faceUrl = faces[cardIdx.toString()];
            const assignment = assignments[cardIdx];
            
            // Determine color based on confidence
            let borderColor = '1px solid var(--glass-border)';
            let boxShadow = 'none';
            if (assignment) {
              if (assignment.confidence > 0.7) {
                borderColor = '2px solid #10b981'; // Green - high confidence
                boxShadow = '0 0 10px rgba(16, 185, 129, 0.3)';
              } else if (assignment.confidence > 0.5) {
                borderColor = '2px solid #f59e0b'; // Yellow - medium confidence
                boxShadow = '0 0 10px rgba(245, 158, 11, 0.3)';
              } else {
                borderColor = '2px solid #ef4444'; // Red - low confidence
                boxShadow = '0 0 10px rgba(239, 68, 68, 0.3)';
              }
            }
            
            return (
              <div
                key={cardIdx}
                className="card-item"
                style={{
                  border: borderColor,
                  boxShadow: boxShadow,
                  position: 'relative'
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
                {assignment && showCardLabels && (
                  <div style={{
                    position: 'absolute',
                    top: '4px',
                    left: '4px',
                    background: 'rgba(0, 0, 0, 0.75)',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 'bold'
                  }}>
                    #{assignment.cardType}
                  </div>
                )}
                {assignment && showCardLabels && (
                  <div style={{
                    position: 'absolute',
                    bottom: '4px',
                    right: '4px',
                    background: 'rgba(0, 0, 0, 0.75)',
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    fontSize: '10px'
                  }}>
                    {(assignment.confidence * 100).toFixed(0)}%
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
                <h3 style={{ color: '#3b82f6', fontSize: '1.1rem', fontWeight: 700, margin: 0 }}>{guideConfig.title}</h3>
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
                {guideConfig.steps.map((step, index) => (
                  <li key={index} style={{ marginBottom: index === guideConfig.steps.length - 1 ? 0 : '0.75rem' }}>
                    <strong style={{ color: '#60a5fa' }}>{step.title}</strong>
                    <br />
                    <span style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                      {step.description}
                    </span>
                  </li>
                ))}
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
                  {guideConfig.tip.icon} <strong>Tip:</strong> {guideConfig.tip.text}
                </p>
              </div>
            </div>
          )}
        </div>

        <header className="header">
          <h1 className="title">มินิเกมส์ เทพเจ้าดอจ</h1>
          <p className="subtitle">สำหรับเหล่าลิงที่ขี้เกียจจำ</p>
        </header>

        <section className="glass-card">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2rem' }}>

            {/* Video Preview */}
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
              {/* Screen Recording Video */}
              <video
                ref={videoRef}
                autoPlay
                muted
                style={{ width: '100%', height: '100%', objectFit: 'contain', display: streamActive ? 'block' : 'none' }}
              />
              
              {/* Uploaded Video */}
              {videoUrl && uploadedVideo && !streamActive && (
                <video
                  ref={uploadVideoRef}
                  src={videoUrl}
                  onLoadedMetadata={handleVideoLoaded}
                  onTimeUpdate={handleTimeUpdate}
                  style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                />
              )}
              
              {!streamActive && !uploadedVideo && !loading && (
                <div style={{ textAlign: 'center', padding: '2rem' }}>
                  <p style={{ color: 'var(--text-dim)', marginBottom: '1rem' }}>Upload a video or capture your game window</p>
                  <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.4)' }}>
                    Choose your preferred method below
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

            {/* Video Upload Controls - Show when video is uploaded */}
            {videoUrl && uploadedVideo && !streamActive && (
              <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
                  <button
                    onClick={handlePlayPause}
                    className="button"
                    style={{ padding: '0.5rem 1rem' }}
                  >
                    {isPlaying ? '⏸' : '▶'}
                  </button>
                  <div style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-dim)' }}>
                    {currentTime.toFixed(1)}s / {videoDuration.toFixed(1)}s
                  </div>
                </div>

                {/* Dual Range Selector with Frame Preview */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                  {/* Input Fields on Left and Right */}
                  <div style={{ display: 'flex', gap: '1rem', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text)' }}>Start:</label>
                      <input
                        type="number"
                        id="start-time-input"
                        min="0"
                        max={videoDuration}
                        step="0.1"
                        value={rangeStart.toFixed(1)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const clamped = Math.max(0, Math.min(val, videoDuration));
                          setRangeStart(clamped);
                          if (clamped > rangeEnd) setRangeEnd(clamped);
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'rgba(59, 130, 246, 0.6)'}
                        onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)'}
                        style={{
                          width: '80px',
                          padding: '0.5rem 0.75rem',
                          textAlign: 'center',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderRadius: '0.375rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: 'var(--text)',
                          fontSize: '0.875rem',
                          fontWeight: '500',
                          outline: 'none',
                          transition: 'all 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>s</span>
                    </div>

                    <div style={{ textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-dim)' }}>
                      Duration: {(rangeEnd - rangeStart).toFixed(1)}s
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                      <label style={{ fontSize: '0.9rem', color: 'var(--text)' }}>End:</label>
                      <input
                        type="number"
                        id="end-time-input"
                        min="0"
                        max={videoDuration}
                        step="0.1"
                        value={rangeEnd.toFixed(1)}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const clamped = Math.max(0, Math.min(val, videoDuration));
                          setRangeEnd(clamped);
                          if (clamped < rangeStart) setRangeStart(clamped);
                        }}
                        onFocus={(e) => e.target.style.borderColor = 'rgba(59, 130, 246, 0.6)'}
                        onBlur={(e) => e.target.style.borderColor = 'rgba(255, 255, 255, 0.2)'}
                        style={{
                          width: '80px',
                          padding: '0.5rem 0.75rem',
                          textAlign: 'center',
                          border: '1px solid rgba(255, 255, 255, 0.2)',
                          borderRadius: '0.375rem',
                          backgroundColor: 'rgba(255, 255, 255, 0.05)',
                          color: 'var(--text)',
                          fontSize: '0.875rem',
                          fontWeight: '500',
                          outline: 'none',
                          transition: 'all 0.2s ease',
                          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
                        }}
                      />
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-dim)' }}>s</span>
                    </div>
                  </div>

                  {/* Dual Range Slider */}
                  <div style={{ position: 'relative', paddingTop: '0.5rem', paddingBottom: '0.5rem' }}>
                    {/* Track background */}
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: '0',
                      right: '0',
                      height: '6px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '3px',
                      transform: 'translateY(-50%)',
                      pointerEvents: 'none'
                    }} />
                    
                    {/* Selected range highlight */}
                    <div style={{
                      position: 'absolute',
                      top: '50%',
                      left: `${(rangeStart / videoDuration) * 100}%`,
                      right: `${100 - (rangeEnd / videoDuration) * 100}%`,
                      height: '6px',
                      background: 'rgba(59, 130, 246, 0.6)',
                      borderRadius: '3px',
                      transform: 'translateY(-50%)',
                      pointerEvents: 'none'
                    }} />

                    {/* Start slider */}
                    <input
                      type="range"
                      min="0"
                      max={videoDuration}
                      step="0.1"
                      value={rangeStart}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (val <= rangeEnd) {
                          setRangeStart(val);
                          seekTo(val);
                        }
                      }}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '24px',
                        zIndex: 4,
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        background: 'transparent',
                        cursor: 'pointer'
                      }}
                    />

                    {/* End slider */}
                    <input
                      type="range"
                      min="0"
                      max={videoDuration}
                      step="0.1"
                      value={rangeEnd}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        if (val >= rangeStart) {
                          setRangeEnd(val);
                          seekTo(val);
                        }
                      }}
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: '24px',
                        zIndex: 5,
                        appearance: 'none',
                        WebkitAppearance: 'none',
                        background: 'transparent',
                        cursor: 'pointer'
                      }}
                    />
                  </div>

                  {/* Frame Preview Section */}
                  <div style={{
                    display: 'flex',
                    gap: '1rem',
                    padding: '1rem',
                    background: 'rgba(0, 0, 0, 0.4)',
                    borderRadius: '0.75rem',
                    border: '1px solid rgba(59, 130, 246, 0.2)'
                  }}>
                    {/* Start Frame */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontWeight: '500' }}>Start Frame</div>
                      <div style={{
                        position: 'relative',
                        width: '100%',
                        paddingBottom: '56.25%',
                        background: 'rgba(0, 0, 0, 0.5)',
                        borderRadius: '0.5rem',
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                      }}>
                        <canvas
                          id="start-frame-canvas"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain'
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'center' }}>
                        {rangeStart.toFixed(2)}s
                      </div>
                    </div>

                    {/* End Frame */}
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                      <div style={{ fontSize: '0.85rem', color: 'var(--text-dim)', fontWeight: '500' }}>End Frame</div>
                      <div style={{
                        position: 'relative',
                        width: '100%',
                        paddingBottom: '56.25%',
                        background: 'rgba(0, 0, 0, 0.5)',
                        borderRadius: '0.5rem',
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.1)'
                      }}>
                        <canvas
                          id="end-frame-canvas"
                          style={{
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain'
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-dim)', textAlign: 'center' }}>
                        {rangeEnd.toFixed(2)}s
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

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
                  {['Extract frames', 'Detect cards', 'Assign card types', 'Extract faces'].map((stepName, idx) => {
                    const completed = progress.stepHistory?.find(s => s.step === stepName);
                    const isCurrent = progress.stage.toLowerCase().includes(stepName.toLowerCase().split(' ')[0] || stepName.toLowerCase());
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

            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              {/* File Upload Input */}
              <input
                type="file"
                accept="video/*"
                onChange={handleVideoFileChange}
                style={{ display: 'none' }}
                id="video-upload"
              />
              <label htmlFor="video-upload" className="button" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                  <polyline points="17 8 12 3 7 8"></polyline>
                  <line x1="12" y1="3" x2="12" y2="15"></line>
                </svg>
                Upload Video
              </label>
              
              {!streamActive && !uploadedVideo ? (
                <button className="button" onClick={initCapture} disabled={loading}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
                  Capture Screen
                </button>
              ) : uploadedVideo && !streamActive ? (
                <button
                  onClick={extractVideoSegment}
                  disabled={loading || rangeEnd <= rangeStart}
                  className="button"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3"></polygon>
                  </svg>
                  Process Video
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                <h2 style={{ fontSize: '1.5rem', color: 'var(--secondary)', margin: 0 }}>
                  ผลลัพธ์
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontSize: '0.9rem', color: 'var(--text)', fontWeight: 500 }}>Labels</span>
                  <button
                    onClick={() => setShowCardLabels(!showCardLabels)}
                    className="toggle-switch"
                    style={{
                      position: 'relative',
                      width: '50px',
                      height: '28px',
                      background: showCardLabels ? 'var(--primary-glow)' : 'rgba(100, 116, 139, 0.3)',
                      border: 'none',
                      borderRadius: '14px',
                      cursor: 'pointer',
                      padding: 0,
                      transition: 'background 0.3s ease',
                      display: 'flex',
                      alignItems: 'center',
                      boxShadow: showCardLabels ? '0 0 12px rgba(124, 58, 237, 0.4)' : 'none'
                    }}
                    title="Toggle Labels"
                  >
                    <div
                      style={{
                        position: 'absolute',
                        width: '22px',
                        height: '22px',
                        background: 'white',
                        borderRadius: '50%',
                        top: '3px',
                        left: showCardLabels ? '25px' : '3px',
                        transition: 'left 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                        boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)'
                      }}
                    />
                  </button>
                </div>
              </div>
              {renderGrid()}
            </section>
          </>
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
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(100%); }
        }
        @keyframes pulse {
          0% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(1.2); }
          100% { opacity: 1; transform: scale(1); }
        }
        .record-dot {
          width: 8px;
          height: 8px;
          background: white;
          border-radius: 50%;
          animation: pulse 1s infinite;
        }
      `}</style>
    </main>
  );
}
