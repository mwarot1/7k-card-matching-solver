'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import Script from 'next/script';

const OpenCVContext = createContext<{ loaded: boolean; error: boolean }>({ loaded: false, error: false });

export const useOpenCV = () => useContext(OpenCVContext);

export const OpenCVProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);

    useEffect(() => {
        // Check if already loaded (for HMR)
        if (typeof window !== 'undefined' && (window as any).cv) {
            setLoaded(true);
        }
    }, []);

    const handleLoad = () => {
        console.log('OpenCV.js script loaded');
        const checkOpenCV = setInterval(() => {
            if ((window as any).cv && (window as any).cv.onRuntimeInitialized) {
                (window as any).cv.onRuntimeInitialized = () => {
                    console.log('OpenCV.js initialized');
                    setLoaded(true);
                    clearInterval(checkOpenCV);
                };
            } else if ((window as any).cv) {
                // Some versions don't expose onRuntimeInitialized this way
                console.log('OpenCV.js ready');
                setLoaded(true);
                clearInterval(checkOpenCV);
            }
        }, 100);

        setTimeout(() => {
            clearInterval(checkOpenCV);
            if (!(window as any).cv) setError(true);
        }, 30000); // 30s timeout
    };

    return (
        <OpenCVContext.Provider value={{ loaded, error }}>
            <Script
                src="/lib/opencv.js"
                strategy="afterInteractive"
                onLoad={handleLoad}
                onError={() => setError(true)}
            />
            {children}
        </OpenCVContext.Provider>
    );
};
