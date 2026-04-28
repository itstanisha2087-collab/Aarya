'use client';

import { motion } from 'framer-motion';
import styles from './LiquidOrb.module.css';

export default function LiquidOrb({ size = 200, spark = false, intense = false }) {
  if (spark) {
    return (
      <div className={styles.sparkWrapper} style={{ width: size, height: size }}>
        {/* Diamond Core */}
        <motion.div 
          className={styles.sparkCore}
          animate={{
            scale: [1, 1.1, 1],
            boxShadow: [
              '0 0 20px rgba(255, 255, 255, 0.3), 0 0 40px rgba(125, 211, 252, 0.2)',
              '0 0 30px rgba(255, 255, 255, 0.5), 0 0 50px rgba(252, 211, 77, 0.3)',
              '0 0 20px rgba(255, 255, 255, 0.3), 0 0 40px rgba(125, 211, 252, 0.2)',
            ]
          }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
        {/* Subtle Outer Glow */}
        <div className={styles.sparkHalo} />
      </div>
    );
  }

  return (
    <div className={styles.wrapper} style={{ width: size, height: size }}>
      <motion.div
        className={styles.neuralCore}
        animate={{ scale: [1, 1.1, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className={`${styles.orb} ${intense ? styles.intense : ''}`}
        animate={{
          scale: [1, 1.05, 1],
          borderRadius: [
            '44% 56% 60% 40% / 50% 44% 56% 50%',
            '60% 40% 42% 58% / 55% 62% 38% 45%',
            '38% 62% 58% 42% / 62% 36% 64% 38%',
            '44% 56% 60% 40% / 50% 44% 56% 50%',
          ],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      >
        <div className={styles.internalGlow} />
      </motion.div>
    </div>
  );
}
