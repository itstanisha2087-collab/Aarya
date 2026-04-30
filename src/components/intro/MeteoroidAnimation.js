import { motion } from 'framer-motion';
import styles from './IntroContainer.module.css';

export default function MeteoroidAnimation({ duration = 2.5 }) {
  // We'll create a thick path using an SVG linearGradient for the tail
  // and a feGaussianBlur for the bloom.
  
  const pathData = "M -200 1200 L 2120 -200"; // Straight diagonal line Bottom-Left to Top-Right
  
  const meteorEase = [0.25, 0.46, 0.45, 0.94];

  return (
    <div className={styles.meteoroidContainer}>
      <svg viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" style={{ width: '100%', height: '100%' }}>
        <defs>
          <filter id="meteorBloom" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="blur1" />
            <feGaussianBlur stdDeviation="12" result="blur2" />
            <feGaussianBlur stdDeviation="24" result="blur3" />
            <feMerge>
              <feMergeNode in="blur3" />
              <feMergeNode in="blur2" />
              <feMergeNode in="blur1" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          <linearGradient id="tailGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255, 255, 255, 0)" />
            <stop offset="80%" stopColor="rgba(255, 255, 255, 0.4)" />
            <stop offset="100%" stopColor="rgba(255, 255, 255, 1)" />
          </linearGradient>
        </defs>

        {/* Thick trailing tail with gradient */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="url(#tailGradient)"
          strokeWidth="40"
          strokeLinecap="round"
          initial={{ pathLength: 0.15, pathOffset: -0.15 }}
          animate={{ pathOffset: 1.1 }}
          transition={{ duration, ease: meteorEase }}
          filter="url(#meteorBloom)"
        />

        {/* Bright Glowing Core */}
        <motion.path
          d={pathData}
          fill="transparent"
          stroke="#FFFFFF"
          strokeWidth="16"
          strokeLinecap="round"
          initial={{ pathLength: 0.02, pathOffset: -0.02 }}
          animate={{ pathOffset: 1.1 }}
          transition={{ duration, ease: meteorEase }}
          filter="url(#meteorBloom)"
        />
      </svg>
    </div>
  );
}
