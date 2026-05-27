'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './IntroContainer.module.css';
import CometPathAnimation from './CometPathAnimation';
import AaryaTextReveal from './AaryaTextReveal';
import CanvasEffects from './CanvasEffects';

export default function IntroContainer({ onComplete }) {
  const [phase, setPhase] = useState('entering'); 
  // 'entering' -> 'dissolve' -> 'pull' -> 'sphere' -> 'compress' -> 'fadeout'

  // Bulletproof fallback timer: force transition to chat if animation hangs
  useEffect(() => {
    const fallback = setTimeout(() => {
      console.log("[AARYA/Intro] Standard intro animation timeout reached. Transitioning to Chat Dashboard...");
      if (onComplete) onComplete();
    }, 5000);
    return () => clearTimeout(fallback);
  }, [onComplete]);

  useEffect(() => {
    let timer1, timer2, timer3, timer4;

    if (phase === 'dissolve') {
      // Particles explode/scatter outward for 500ms
      timer1 = setTimeout(() => setPhase('pull'), 500);
    } else if (phase === 'pull') {
      // Magnetic pull to center for 800ms
      timer2 = setTimeout(() => setPhase('sphere'), 800);
    } else if (phase === 'sphere') {
      // Hold 3D sphere shape and rotate for 1.5s
      timer3 = setTimeout(() => setPhase('compress'), 1500);
    } else if (phase === 'compress') {
      // Compress into core and hold for 1s before fadeout
      timer4 = setTimeout(() => setPhase('fadeout'), 1000);
    }

    return () => {
      if (timer1) clearTimeout(timer1);
      if (timer2) clearTimeout(timer2);
      if (timer3) clearTimeout(timer3);
      if (timer4) clearTimeout(timer4);
    };
  }, [phase]);

  const handleTextComplete = () => {
    // Fired right as the comet is exiting top-right
    setPhase('dissolve');
  };

  const handleCanvasComplete = () => {
    if (onComplete) onComplete();
  };

  return (
    <div className={styles.container}>
      <AnimatePresence>
        {phase === 'entering' && (
          <motion.div 
            key="comet-sequence" 
            style={{ width: '100%', height: '100%', position: 'absolute' }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
          >
            <CometPathAnimation duration={3.5} />
            <AaryaTextReveal isVisible={true} onComplete={handleTextComplete} />
          </motion.div>
        )}
      </AnimatePresence>

      <CanvasEffects 
        phase={phase === 'entering' ? 'idle' : phase} 
        onComplete={handleCanvasComplete} 
      />
    </div>
  );
}
