import { motion } from 'framer-motion';
import styles from './IntroContainer.module.css';

export default function MeteoroidSlash({ duration = 1.0 }) {
  const pathData = "M -200 1200 L 2120 -200"; // Straight diagonal line
  const meteorEase = "easeIn";

  return (
    <div className={styles.meteoroidContainer}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%' }}>
        <defs>
          <filter id="slashBloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur1" />
            <feGaussianBlur stdDeviation="6" result="blur2" />
            <feMerge>
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient id="slashTail" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0)" />
            <stop offset="90%" stopColor="rgba(255, 255, 255, 0.2)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 1)" />
          </linearGradient>
        </defs>

        {/* Short, subtle tail */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="url(#slashTail)"
          strokeWidth="6"
          strokeLinecap="round"
          initial={{ pathLength: 0.1, pathOffset: -0.1 }}
          animate={{ pathOffset: 1.1 }}
          transition={{ duration, ease: meteorEase }}
          filter="url(#slashBloom)"
        />

        {/* Sharp Needle Head */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          initial={{ pathLength: 0.005, pathOffset: -0.005 }}
          animate={{ pathOffset: 1.1 }}
          transition={{ duration, ease: meteorEase }}
          filter="url(#slashBloom)"
        />
      </svg>
    </div>
  );
}
