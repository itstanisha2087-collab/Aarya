'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ParticleMorph from './ParticleMorph';
import ChatInterface from './ChatInterface';
import styles from './ReactiveGrid.module.css';

export default function ReactiveGrid() {
  const [gridFormed, setGridFormed] = useState(false);
  const particleMorphRef = useRef(null);
  const [showChat, setShowChat] = useState(false);

  const handleGridFormed = useCallback(() => {
    setGridFormed(true);
    // Reveal chat after the grid has settled
    setTimeout(() => setShowChat(true), 600);
  }, []);

  return (
    <div className={styles.container}>
      {/* ── Particle System — Top Section ── */}
      <div className={styles.particleSection}>
        <ParticleMorph
          ref={particleMorphRef}
          onGridFormed={handleGridFormed}
          mode="idle"
        />

        {/* Status indicator */}
        <AnimatePresence>
          {gridFormed && (
            <motion.div
              className={styles.statusLabel}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              <span className={styles.statusDot} />
              <span className={styles.statusText}>ONLINE</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Chat Interface — Bottom Section ── */}
      <AnimatePresence>
        {showChat && (
          <motion.div
            className={styles.chatSection}
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
          >
            <ChatInterface />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
