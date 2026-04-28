'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import styles from './CometEntry.module.css';

export default function CometEntry({ onComplete }) {
  const [phase, setPhase] = useState('entering');

  useEffect(() => {
    // 4.5 seconds total for the animation sequence, then hand off to particle morph
    const timer = setTimeout(() => {
      setPhase('done');
      if (onComplete) onComplete();
    }, 4500);
    return () => clearTimeout(timer);
  }, [onComplete]);

  // The perfect loop path.
  // ViewBox: 0 0 1920 1080. Center is 960, 540.
  // Comet enters bottom-left, loops in center, exits top-right.
  const pathData = "M -200 1200 C 300 900, 700 800, 960 700 C 1200 600, 1200 380, 960 380 C 720 380, 720 700, 960 700 C 1100 700, 1600 500, 2120 -200";

  // Easing curve for cinematic smooth motion
  const cometEase = [0.25, 0.46, 0.45, 0.94];
  const duration = 3.5;

  const letters = ['A', 'A', 'R', 'Y', 'A'];

  return (
    <motion.div
      className={styles.container}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
    >
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" className={styles.svgLayer}>
        <defs>
          <filter id="bloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="blur1" />
            <feGaussianBlur stdDeviation="16" result="blur2" />
            <feGaussianBlur stdDeviation="32" result="blur3" />
            <feMerge>
              <feMergeNode in="blur3" />
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Faint long tail */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="rgba(255, 255, 255, 0.15)"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0.2, pathOffset: -0.2 }}
          animate={{ pathOffset: 1 }}
          transition={{ duration, ease: cometEase }}
        />

        {/* Mid tail */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="rgba(255, 255, 255, 0.4)"
          strokeWidth="6"
          strokeLinecap="round"
          initial={{ pathLength: 0.08, pathOffset: -0.08 }}
          animate={{ pathOffset: 1 }}
          transition={{ duration, ease: cometEase }}
        />

        {/* Bright Head */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="#FFFFFF"
          strokeWidth="12"
          strokeLinecap="round"
          initial={{ pathLength: 0.015, pathOffset: -0.015 }}
          animate={{ pathOffset: 1 }}
          transition={{ duration, ease: cometEase }}
          filter="url(#bloom)"
        />
      </svg>

      <div className={styles.textContainer}>
        {letters.map((char, index) => {
          // 'A' appears at loop start (1.2s), rest appear as comet exits (2.2s+)
          const delay = index === 0 ? 1.2 : 2.2 + (index - 1) * 0.15;
          return (
            <motion.span
              key={index}
              className={styles.letter}
              initial={{ opacity: 0, scale: 0.8, filter: 'blur(10px)' }}
              animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
              transition={{ delay, duration: 1.2, ease: 'easeOut' }}
            >
              {char}
            </motion.span>
          );
        })}
      </div>

      <div className={`${styles.textGlow} ${phase !== 'done' ? styles.textGlowActive : ''}`} />
    </motion.div>
  );
}
