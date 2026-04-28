'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ParticleMorph from './ParticleMorph';
import ChatInterface from './ChatInterface';
import styles from './ReactiveGrid.module.css';

export default function ReactiveGrid() {
  const [gridFormed, setGridFormed] = useState(false);
  const [activeMode, setActiveMode] = useState('idle'); // 'idle' | 'voice' | 'chat'
  const [isListening, setIsListening] = useState(false);
  const particleMorphRef = useRef(null);
  const [showControls, setShowControls] = useState(false);

  const handleGridFormed = useCallback(() => {
    setGridFormed(true);
    // Fade in controls after a beat
    setTimeout(() => setShowControls(true), 800);
  }, []);

  const toggleVoice = useCallback(() => {
    if (activeMode === 'voice') {
      setActiveMode('idle');
      setIsListening(false);
      if (particleMorphRef.current) {
        particleMorphRef.current.setMode('idle');
      }
    } else {
      setActiveMode('voice');
      setIsListening(true);
      if (particleMorphRef.current) {
        particleMorphRef.current.setMode('voice');
      }
    }
  }, [activeMode]);

  const toggleChat = useCallback(() => {
    if (activeMode === 'chat') {
      setActiveMode('idle');
      if (particleMorphRef.current) {
        particleMorphRef.current.setMode('idle');
      }
    } else {
      setActiveMode('chat');
      setIsListening(false);
      if (particleMorphRef.current) {
        particleMorphRef.current.setMode('chat-shrink');
      }
    }
  }, [activeMode]);

  // Keyboard shortcut: press '/' to activate chat
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '/' && activeMode !== 'chat' && gridFormed) {
        e.preventDefault();
        toggleChat();
      }
      if (e.key === 'Escape' && activeMode !== 'idle') {
        setActiveMode('idle');
        setIsListening(false);
        if (particleMorphRef.current) {
          particleMorphRef.current.setMode('idle');
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeMode, gridFormed, toggleChat]);

  return (
    <div className={styles.container}>
      {/* Particle System */}
      <ParticleMorph
        ref={particleMorphRef}
        onGridFormed={handleGridFormed}
        mode={activeMode === 'voice' ? 'voice' : activeMode === 'chat' ? 'chat-shrink' : 'idle'}
      />

      {/* Status indicator */}
      <AnimatePresence>
        {gridFormed && activeMode === 'idle' && (
          <motion.div
            className={styles.statusLabel}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className={styles.statusDot} />
            <span className={styles.statusText}>READY</span>
          </motion.div>
        )}
        {activeMode === 'voice' && (
          <motion.div
            className={styles.statusLabel}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className={`${styles.statusDot} ${styles.statusDotActive}`} />
            <span className={styles.statusText}>LISTENING</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Controls */}
      <AnimatePresence>
        {showControls && (
          <motion.div
            className={styles.controls}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          >
            {/* Voice Button */}
            <button
              className={`${styles.controlBtn} ${activeMode === 'voice' ? styles.controlBtnActive : ''}`}
              onClick={toggleVoice}
              aria-label="Toggle voice mode"
              id="voice-toggle-btn"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" y1="19" x2="12" y2="23" />
                <line x1="8" y1="23" x2="16" y2="23" />
              </svg>
              {activeMode === 'voice' && (
                <motion.div
                  className={styles.btnRing}
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: [1, 1.3, 1], opacity: [0.5, 0.2, 0.5] }}
                  transition={{ repeat: Infinity, duration: 2, ease: 'easeInOut' }}
                />
              )}
            </button>

            {/* Chat Button */}
            <button
              className={`${styles.controlBtn} ${activeMode === 'chat' ? styles.controlBtnActive : ''}`}
              onClick={toggleChat}
              aria-label="Toggle chat mode"
              id="chat-toggle-btn"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
            </button>

            {/* Keyboard hint */}
            {activeMode === 'idle' && (
              <motion.span
                className={styles.hint}
                initial={{ opacity: 0 }}
                animate={{ opacity: 0.3 }}
                transition={{ delay: 2, duration: 1 }}
              >
                press / to chat
              </motion.span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Chat Interface */}
      <AnimatePresence>
        {activeMode === 'chat' && (
          <ChatInterface
            onClose={() => {
              setActiveMode('idle');
              if (particleMorphRef.current) {
                particleMorphRef.current.setMode('idle');
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
