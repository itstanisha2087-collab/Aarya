'use client';

import { useEffect, useRef, useCallback, useState, forwardRef, useImperativeHandle } from 'react';
import { Particle, getTextParticlePositions, getGridPositions } from './ParticleEngine';
import styles from './ParticleMorph.module.css';

const GRID_SIZE = 4;
const GRID_SPACING = 28;
const PARTICLE_COUNT = GRID_SIZE * GRID_SIZE; // 16 final particles

const ParticleMorph = forwardRef(function ParticleMorph({ onGridFormed, mode = 'idle' }, ref) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animFrameRef = useRef(null);
  const phaseRef = useRef('text-dissolve'); // 'text-dissolve' | 'forming-grid' | 'grid-idle'
  const modeRef = useRef(mode);
  const gridCenterRef = useRef({ x: 0, y: 0 });

  // Expose methods to parent
  useImperativeHandle(ref, () => ({
    setMode: (newMode) => {
      modeRef.current = newMode;
      applyMode(newMode);
    },
    getGridCenter: () => gridCenterRef.current,
  }));

  const applyMode = useCallback((newMode) => {
    const particles = particlesRef.current;
    const cx = gridCenterRef.current.x;
    const cy = gridCenterRef.current.y;

    particles.forEach((p, i) => {
      const gridPos = getGridPositions(GRID_SIZE, GRID_SPACING, cx, cy);
      if (gridPos[i]) {
        if (newMode === 'voice') {
          p.phase = 'wave';
          p.waveOffset = i * 0.6;
          p.waveAmplitude = 8 + (Math.abs(i % GRID_SIZE - (GRID_SIZE - 1) / 2)) * 4;
          // Center columns have MORE amplitude
          const col = i % GRID_SIZE;
          const distFromCenter = Math.abs(col - (GRID_SIZE - 1) / 2);
          p.waveAmplitude = 12 - distFromCenter * 3;
          if (p.waveAmplitude < 4) p.waveAmplitude = 4;
        } else if (newMode === 'breathe') {
          p.phase = 'breathe';
          p.breatheOffset = i * 0.4;
          p.breatheCenterX = cx;
          p.breatheCenterY = cy;
        } else if (newMode === 'chat-shrink') {
          // Animate grid to top-right corner
          const cornerX = window.innerWidth - 80;
          const cornerY = 60;
          const miniSpacing = 10;
          const gridPos = getGridPositions(GRID_SIZE, miniSpacing, cornerX, cornerY);
          if (gridPos[i]) {
            p.targetX = gridPos[i].x;
            p.targetY = gridPos[i].y;
            p.baseSize = 2;
            p.phase = 'converge';
          }
        } else {
          // idle - return to center grid
          p.targetX = gridPos[i].x;
          p.targetY = gridPos[i].y;
          p.baseSize = 3;
          p.phase = 'converge';
        }
      }
    });
  }, []);

  useEffect(() => {
    modeRef.current = mode;
    if (phaseRef.current === 'grid-idle') {
      applyMode(mode);
    }
  }, [mode, applyMode]);

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
    };
    resize();
    window.addEventListener('resize', resize);

    const width = window.innerWidth;
    const height = window.innerHeight;
    const centerX = width / 2;
    const centerY = height / 2;
    gridCenterRef.current = { x: centerX, y: centerY };

    // ── Phase 1: Get text positions for "AARYA" ──
    const fontSize = Math.min(width * 0.1, 120);
    const textPositions = getTextParticlePositions(
      'AARYA', fontSize, fontSize * 0.45, width, height
    );

    // ── Create particles from text positions, targeting grid ──
    const gridPositions = getGridPositions(GRID_SIZE, GRID_SPACING, centerX, centerY);
    const particles = [];

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Start position: random from text
      const textPos = textPositions[Math.floor(Math.random() * textPositions.length)] || { x: centerX, y: centerY };
      const gridPos = gridPositions[i];

      const p = new Particle(textPos.x, textPos.y, gridPos.x, gridPos.y);
      p.waveOffset = i * 0.5;
      p.breatheOffset = i * 0.3;
      p.delay = i * 60;
      p.opacity = 0;
      particles.push(p);
    }

    // Also create "debris" particles that fade out (text dust)
    const debrisCount = Math.min(textPositions.length, 80);
    const debrisParticles = [];
    for (let i = 0; i < debrisCount; i++) {
      const pos = textPositions[Math.floor(i * textPositions.length / debrisCount)];
      if (pos) {
        const dp = new Particle(pos.x, pos.y, pos.x, pos.y);
        dp.phase = 'debris';
        dp.velocity.x = (Math.random() - 0.5) * 8;
        dp.velocity.y = (Math.random() - 0.5) * 8;
        dp.opacity = 0.6;
        dp.size = 1 + Math.random() * 2;
        dp.lifespan = 800 + Math.random() * 600;
        dp.born = 0;
        debrisParticles.push(dp);
      }
    }

    particlesRef.current = particles;

    // ── Animation loop ──
    const startTime = performance.now();
    let gridFormedNotified = false;

    const animate = (now) => {
      const elapsed = now - startTime;
      const dprVal = window.devicePixelRatio || 1;
      ctx.setTransform(dprVal, 0, 0, dprVal, 0, 0);
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      // Phase management
      if (elapsed < 300) {
        // Brief pause
      } else if (elapsed < 1200) {
        // Scatter phase - particles emerge from text and scatter
        const scatterProgress = (elapsed - 300) / 900;
        particles.forEach((p, i) => {
          if (elapsed - 300 > p.delay && p.phase !== 'scatter' && p.phase !== 'converge') {
            p.opacity = 1;
            p.scatter(1.5);
          }
          p.update(now);
          p.draw(ctx);
        });

        // Draw debris
        debrisParticles.forEach((dp) => {
          if (dp.born === 0) dp.born = elapsed;
          const age = elapsed - dp.born;
          if (age < dp.lifespan) {
            dp.x += dp.velocity.x * 0.98;
            dp.y += dp.velocity.y * 0.98;
            dp.velocity.x *= 0.96;
            dp.velocity.y *= 0.96;
            dp.opacity = 0.6 * (1 - age / dp.lifespan);
            dp.size *= 0.998;

            ctx.save();
            ctx.globalAlpha = dp.opacity;
            ctx.fillStyle = '#FFFFFF';
            ctx.beginPath();
            ctx.arc(dp.x, dp.y, dp.size, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
          }
        });

        phaseRef.current = 'text-dissolve';
      } else if (elapsed < 2500) {
        // Converge phase - particles pull toward grid
        particles.forEach((p) => {
          if (p.phase === 'scatter') {
            p.converge();
          }
          p.update(now);
          p.draw(ctx);
        });
        phaseRef.current = 'forming-grid';
      } else {
        // Grid formed - enter idle/reactive state
        if (!gridFormedNotified) {
          gridFormedNotified = true;
          phaseRef.current = 'grid-idle';
          if (onGridFormed) onGridFormed();
          // Apply current mode
          applyMode(modeRef.current);
        }

        particles.forEach((p) => {
          p.update(now);
          p.draw(ctx);
        });

        // Draw subtle connection lines between adjacent grid particles
        if (modeRef.current !== 'chat-shrink') {
          ctx.save();
          ctx.strokeStyle = 'rgba(255,255,255,0.04)';
          ctx.lineWidth = 0.5;
          for (let i = 0; i < particles.length; i++) {
            for (let j = i + 1; j < particles.length; j++) {
              const dx = particles[i].x - particles[j].x;
              const dy = particles[i].y - particles[j].y;
              const dist = Math.sqrt(dx * dx + dy * dy);
              if (dist < GRID_SPACING * 1.8) {
                ctx.globalAlpha = Math.max(0, 0.06 - (dist / (GRID_SPACING * 1.8)) * 0.06);
                ctx.beginPath();
                ctx.moveTo(particles[i].x, particles[i].y);
                ctx.lineTo(particles[j].x, particles[j].y);
                ctx.stroke();
              }
            }
          }
          ctx.restore();
        }
      }

      animFrameRef.current = requestAnimationFrame(animate);
    };

    animFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', resize);
    };
  }, [onGridFormed, applyMode]);

  return (
    <canvas
      ref={canvasRef}
      className={styles.particleCanvas}
    />
  );
});

export default ParticleMorph;
