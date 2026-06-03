'use client';

import { useState, useCallback, useEffect } from 'react';
import { AnimatePresence } from 'framer-motion';
import IntroContainer from '@/components/intro/IntroContainer';
import ChatInterface from '@/components/ChatInterface';
import WindowDragRegion from '@/components/WindowDragRegion';

export default function Home() {
  const [phase, setPhase] = useState('intro'); // 'intro' | 'chat'
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleIntroComplete = useCallback(() => {
    setPhase('chat');
  }, []);

  if (!mounted) {
    return <main style={{ width: '100vw', height: '100vh', background: '#000000' }} />;
  }

  return (
    <main
      style={{
        width: '100vw',
        height: '100vh',
        background: '#000000',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* Draggable header and custom window controls only during intro */}
      {mounted && phase === 'intro' && typeof window !== 'undefined' && window.ipcRenderer && (
        <>
          <WindowDragRegion />
          
          {/* Top Right Controls Group */}
          <div style={{
            position: 'absolute',
            top: '12px',
            right: '16px',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            WebkitAppRegion: 'no-drag'
          }}>
            {/* Minimize */}
            <button
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '4px',
                display: 'grid',
                placeItems: 'center',
                color: 'rgba(255, 255, 255, 0.35)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onClick={() => window.ipcRenderer.send('minimize-window-req')}
              title="Minimize"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.35)';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            {/* Maximize */}
            <button
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '4px',
                display: 'grid',
                placeItems: 'center',
                color: 'rgba(255, 255, 255, 0.35)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onClick={() => window.ipcRenderer.send('maximize-window-req')}
              title="Maximize"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.85)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.35)';
              }}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
            </button>
            {/* Close to Tray */}
            <button
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '4px',
                display: 'grid',
                placeItems: 'center',
                color: 'rgba(255, 255, 255, 0.35)',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
              onClick={() => window.ipcRenderer.send('close-window-req')}
              title="Close to Tray"
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)';
                e.currentTarget.style.color = 'rgba(248, 113, 113, 1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.35)';
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>
        </>
      )}

      <AnimatePresence mode="wait">
        {phase === 'intro' && (
          <IntroContainer key="intro" onComplete={handleIntroComplete} />
        )}
      </AnimatePresence>

      {phase === 'chat' && (
        <ChatInterface key="chat" />
      )}
    </main>
  );
}
