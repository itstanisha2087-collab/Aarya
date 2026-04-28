'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import styles from './SparkReveal.module.css';

export default function SparkReveal({ onComplete }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const animFrameRef = useRef(null);
  const [phase, setPhase] = useState('sweeping'); // 'sweeping' | 'revealed' | 'done'

  const drawSpark = useCallback((ctx, width, height, progress) => {
    ctx.clearRect(0, 0, width, height);

    // Light sweep position
    const sparkX = progress * (width + 400) - 200;
    const sparkWidth = 180;

    // ── Soft bloom/glow trail ──
    const trailGrad = ctx.createLinearGradient(
      sparkX - sparkWidth * 3, 0,
      sparkX + sparkWidth * 0.5, 0
    );
    trailGrad.addColorStop(0, 'rgba(255,255,255,0)');
    trailGrad.addColorStop(0.3, 'rgba(255,255,255,0.01)');
    trailGrad.addColorStop(0.7, 'rgba(255,255,255,0.03)');
    trailGrad.addColorStop(1, 'rgba(255,255,255,0.08)');

    ctx.fillStyle = trailGrad;
    ctx.fillRect(0, height * 0.3, sparkX, height * 0.4);

    // ── Main light streak ──
    const mainGrad = ctx.createLinearGradient(
      sparkX - sparkWidth, 0,
      sparkX + sparkWidth, 0
    );
    mainGrad.addColorStop(0, 'rgba(255,255,255,0)');
    mainGrad.addColorStop(0.2, 'rgba(255,255,255,0.05)');
    mainGrad.addColorStop(0.4, 'rgba(255,255,255,0.2)');
    mainGrad.addColorStop(0.5, 'rgba(255,255,255,0.9)');
    mainGrad.addColorStop(0.6, 'rgba(255,255,255,0.2)');
    mainGrad.addColorStop(0.8, 'rgba(255,255,255,0.05)');
    mainGrad.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = mainGrad;
    ctx.fillRect(sparkX - sparkWidth, 0, sparkWidth * 2, height);

    // ── Bright core line ──
    const coreY = height / 2;
    const coreGrad = ctx.createRadialGradient(
      sparkX, coreY, 0,
      sparkX, coreY, sparkWidth * 1.5
    );
    coreGrad.addColorStop(0, 'rgba(255,255,255,0.95)');
    coreGrad.addColorStop(0.1, 'rgba(255,255,255,0.6)');
    coreGrad.addColorStop(0.3, 'rgba(255,255,255,0.15)');
    coreGrad.addColorStop(0.6, 'rgba(255,255,255,0.03)');
    coreGrad.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(sparkX, coreY, sparkWidth * 1.5, 0, Math.PI * 2);
    ctx.fill();

    // ── Horizontal beam through center ──
    ctx.save();
    ctx.globalAlpha = 0.7;
    const beamGrad = ctx.createLinearGradient(
      sparkX - sparkWidth * 2, 0,
      sparkX + sparkWidth * 0.3, 0
    );
    beamGrad.addColorStop(0, 'rgba(255,255,255,0)');
    beamGrad.addColorStop(0.5, 'rgba(255,255,255,0.1)');
    beamGrad.addColorStop(0.8, 'rgba(255,255,255,0.4)');
    beamGrad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = beamGrad;
    ctx.fillRect(sparkX - sparkWidth * 2, coreY - 1.5, sparkWidth * 2.3, 3);
    ctx.restore();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    // Animation timing
    const duration = 2000; // 2 seconds sweep
    const startTime = performance.now();

    const animate = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);

      // Eased progress for smooth motion
      const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawSpark(ctx, window.innerWidth, window.innerHeight, eased);

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setPhase('revealed');
        // Hold revealed text for 1.5 seconds then signal completion
        setTimeout(() => {
          setPhase('done');
          if (onComplete) onComplete();
        }, 1500);
      }
    };

    // Small delay before animation starts
    const timeout = setTimeout(() => {
      animFrameRef.current = requestAnimationFrame(animate);
    }, 500);

    return () => {
      clearTimeout(timeout);
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [drawSpark, onComplete]);

  return (
    <motion.div
      ref={containerRef}
      className={styles.container}
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Canvas for light sweep effect */}
      <canvas ref={canvasRef} className={styles.sparkCanvas} />

      {/* The AARYA text with clip-path reveal */}
      <div className={styles.textContainer}>
        <motion.h1
          className={styles.aaryaText}
          initial={{ opacity: 0 }}
          animate={{
            opacity: phase === 'sweeping' ? [0, 0.1, 0.6, 1] : 1,
          }}
          transition={{
            duration: 2,
            times: [0, 0.3, 0.7, 1],
            ease: 'easeOut',
          }}
        >
          AARYA
        </motion.h1>

        {/* Ambient glow behind text */}
        <div className={`${styles.textGlow} ${phase !== 'sweeping' ? styles.textGlowActive : ''}`} />
      </div>
    </motion.div>
  );
}
