'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LiquidOrb from './LiquidOrb';
import styles from './IntroAnimation.module.css';

export default function IntroAnimation({ onComplete }) {
  const [phase, setPhase] = useState('gliding'); // 'gliding', 'colliding', 'shrinking', 'done'

  useEffect(() => {
    const timer1 = setTimeout(() => setPhase('colliding'), 2800);
    const timer2 = setTimeout(() => setPhase('shrinking'), 3300);
    const timer3 = setTimeout(() => onComplete(), 5000);

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [onComplete]);

  return (
    <div className={styles.container}>
      <AnimatePresence mode="wait">
        {(phase === 'gliding' || phase === 'colliding') ? (
          <motion.div
            key="power-gliding"
            className={styles.stage}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            {/* Massive Blue Cloud (Left) */}
            <motion.div
              className={styles.powerOrb}
              initial={{ x: '-100vw' }}
              animate={{ x: phase === 'colliding' ? 0 : -30 }}
              transition={{ duration: 2.8, ease: [0.45, 0, 0.55, 1] }}
            >
              <div 
                className={styles.cloud} 
                style={{ backgroundColor: '#7DD3FC', opacity: 0.8, filter: 'blur(100px)' }} 
              />
            </motion.div>

            {/* Massive Amber Cloud (Right) */}
            <motion.div
              className={styles.powerOrb}
              initial={{ x: '100vw' }}
              animate={{ x: phase === 'colliding' ? 0 : 30 }}
              transition={{ duration: 2.8, ease: [0.45, 0, 0.55, 1] }}
            >
              <div 
                className={styles.cloud} 
                style={{ backgroundColor: '#FCD34D', opacity: 0.8, filter: 'blur(100px)' }} 
              />
            </motion.div>

            {/* Quick Flash */}
            {phase === 'colliding' && (
              <motion.div
                className={styles.impactFlash}
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: [1, 5], opacity: [0, 1, 0] }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
              />
            )}
          </motion.div>
        ) : phase === 'shrinking' ? (
          <motion.div
            key="spark-birth"
            className={styles.stage}
            initial={{ scale: 2, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 1, ease: [0.34, 1.56, 0.64, 1] }}
          >
            <div className={styles.sparkAnchor}>
              <LiquidOrb size={25} spark />
              <motion.p 
                className={styles.greeting}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 0.6, y: 0 }}
                transition={{ delay: 0.5, duration: 1 }}
              >
                establishing connection...
              </motion.p>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button className={styles.skipBtn} onClick={onComplete}>
        skip
      </button>
    </div>
  );
}
