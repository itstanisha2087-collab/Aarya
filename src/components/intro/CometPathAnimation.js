import { motion } from 'framer-motion';
import styles from './IntroContainer.module.css';

export default function CometPathAnimation({ duration = 3.5 }) {
  // Cubic Bezier path for a smooth 360 loop in the center
  // ViewBox: 0 0 1920 1080. Center is 960, 540.
  // Enters Bottom-Left -> Center Loop -> Exits Top-Right
  const pathData = "M -200 1200 C 300 900, 700 800, 960 700 C 1200 600, 1200 380, 960 380 C 720 380, 720 700, 960 700 C 1100 700, 1600 500, 2120 -200";
  
  const cometEase = [0.25, 0.46, 0.45, 0.94]; // Smooth cinematic ease

  return (
    <div className={styles.meteoroidContainer}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%' }}>
        <defs>
          <filter id="cometBloom" x="-50%" y="-50%" width="200%" height="200%">
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

          <linearGradient id="cometTail" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0)" />
            <stop offset="60%" stopColor="rgba(255, 255, 255, 0.3)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 1)" />
          </linearGradient>
        </defs>

        {/* Faint long tail */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="url(#cometTail)"
          strokeWidth="4"
          strokeLinecap="round"
          initial={{ pathLength: 0.15, pathOffset: -0.15 }}
          animate={{ pathOffset: 1 }}
          transition={{ duration, ease: cometEase }}
        />

        {/* Mid tail (Thicker) */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="url(#cometTail)"
          strokeWidth="10"
          strokeLinecap="round"
          initial={{ pathLength: 0.08, pathOffset: -0.08 }}
          animate={{ pathOffset: 1 }}
          transition={{ duration, ease: cometEase }}
        />

        {/* Bright Glowing Head (Teardrop core) */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="#FFFFFF"
          strokeWidth="20"
          strokeLinecap="round"
          initial={{ pathLength: 0.02, pathOffset: -0.02 }}
          animate={{ pathOffset: 1 }}
          transition={{ duration, ease: cometEase }}
          filter="url(#cometBloom)"
        />
      </svg>
    </div>
  );
}
