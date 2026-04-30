import { useEffect, useRef } from 'react';
import styles from './IntroContainer.module.css';

export default function CanvasEffects({ phase, onComplete }) {
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animationRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    
    if (phase === 'dissolve' && particlesRef.current.length === 0) {
      const pCount = 600; // Dense star particles
      const newParticles = [];
      
      for (let i = 0; i < pCount; i++) {
        // Start precisely within the text bounding area
        const startX = canvas.width / 2 + (Math.random() - 0.5) * 600;
        const startY = canvas.height / 2 + (Math.random() - 0.5) * 150;
        
        // Initial outward scatter
        const vx = (Math.random() - 0.5) * 10;
        const vy = (Math.random() - 0.5) * 10;
        
        newParticles.push({
          x: startX,
          y: startY,
          vx: vx,
          vy: vy,
          radius: Math.random() * 1.5 + 0.5, // Small glowing dots
          alpha: Math.random() * 0.5 + 0.5,
          // Pre-calculate sphere coordinates
          sphereTheta: Math.random() * 2 * Math.PI,
          spherePhi: Math.acos(2 * Math.random() - 1),
          baseR: 250, // Base sphere radius
          currentR: 250,
        });
      }
      particlesRef.current = newParticles;
    }

    let time = 0;

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const particles = particlesRef.current;
      time += 0.015;

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;

      particles.forEach(p => {
        if (phase === 'dissolve') {
          // Explode / scatter outward
          p.x += p.vx;
          p.y += p.vy;
          p.vx *= 0.95; // Friction
          p.vy *= 0.95;
          p.alpha = Math.max(0.2, Math.min(1, p.alpha + (Math.random() - 0.5) * 0.1));
          
        } else if (phase === 'pull') {
          // Magnetic pull toward center
          const dx = centerX - p.x;
          const dy = centerY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          
          if (dist > 50) {
            p.vx += (dx / dist) * 0.8;
            p.vy += (dy / dist) * 0.8;
            // Cap speed
            p.vx *= 0.92;
            p.vy *= 0.92;
          }
          p.x += p.vx;
          p.y += p.vy;
          
        } else if (phase === 'sphere' || phase === 'compress' || phase === 'fadeout') {
          
          if (phase === 'compress' || phase === 'fadeout') {
            // Smoothly shrink radius down to a tiny core (e.g. 5px radius)
            p.currentR += (5 - p.currentR) * 0.05;
          } else {
            // Maintain base radius with slight noise
            p.currentR += (p.baseR - p.currentR) * 0.05;
          }

          const currentTheta = p.sphereTheta + time;
          
          const targetX = canvas.width / 2 + p.currentR * Math.sin(p.spherePhi) * Math.cos(currentTheta);
          const targetY = canvas.height / 2 + p.currentR * Math.cos(p.spherePhi) - (Math.sin(currentTheta) * 20); // slight tilt
          
          const z = p.currentR * Math.sin(p.spherePhi) * Math.sin(currentTheta);
          const zScale = (z + p.baseR) / (p.baseR * 2 || 1); // 0 to 1
          
          // Interpolate current pos to target pos smoothly
          p.x += (targetX - p.x) * 0.08;
          p.y += (targetY - p.y) * 0.08;
          
          p.currentRadius = p.radius * (0.5 + zScale * 1.5);
          p.currentAlpha = p.alpha * (0.1 + zScale * 0.9);
          
          if (phase === 'fadeout') {
             p.currentAlpha *= Math.max(0, 1 - (time * 2)); // Fast fade
          }
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.1, p.currentRadius || p.radius), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.max(0, p.currentAlpha || p.alpha)})`;
        ctx.fill();
        
        ctx.shadowBlur = phase === 'compress' ? 15 : 5;
        ctx.shadowColor = 'rgba(255,255,255,0.8)';
      });

      if (phase === 'fadeout' && time > 0.5) {
         if (onComplete) onComplete();
         return; 
      }

      animationRef.current = requestAnimationFrame(animate);
    };

    if (phase !== 'idle') {
      animate();
    }

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [phase, onComplete]);

  return <canvas ref={canvasRef} className={styles.canvasContainer} />;
}
