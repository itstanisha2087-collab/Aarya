'use client';

/**
 * ParticleEngine.js
 * 
 * High-performance Canvas-based particle system for AARYA.
 * Handles text-to-particle disintegration and grid formation.
 * All animations use requestAnimationFrame for 60fps.
 */

// ── Particle class ──
export class Particle {
  constructor(x, y, targetX, targetY) {
    this.x = x;
    this.y = y;
    this.originX = x;
    this.originY = y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.size = 3;
    this.baseSize = 3;
    this.opacity = 1;
    this.velocity = { x: 0, y: 0 };
    this.friction = 0.92;
    this.springStrength = 0.08;
    this.phase = 'idle'; // 'scatter' | 'converge' | 'idle' | 'wave' | 'breathe'
    this.delay = 0;
    this.glowIntensity = 0.5;
    this.waveOffset = 0;
    this.breatheOffset = 0;
  }

  scatter(force = 1) {
    this.velocity.x = (Math.random() - 0.5) * 15 * force;
    this.velocity.y = (Math.random() - 0.5) * 15 * force;
    this.phase = 'scatter';
  }

  converge() {
    this.phase = 'converge';
  }

  update(time) {
    if (this.phase === 'scatter') {
      this.x += this.velocity.x;
      this.y += this.velocity.y;
      this.velocity.x *= this.friction;
      this.velocity.y *= this.friction;
      this.opacity = Math.max(0.3, this.opacity - 0.005);

      if (Math.abs(this.velocity.x) < 0.1 && Math.abs(this.velocity.y) < 0.1) {
        this.phase = 'converge';
      }
    }

    if (this.phase === 'converge') {
      const dx = this.targetX - this.x;
      const dy = this.targetY - this.y;
      this.velocity.x += dx * this.springStrength;
      this.velocity.y += dy * this.springStrength;
      this.velocity.x *= this.friction;
      this.velocity.y *= this.friction;
      this.x += this.velocity.x;
      this.y += this.velocity.y;
      this.opacity = Math.min(1, this.opacity + 0.02);

      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 0.5) {
        this.x = this.targetX;
        this.y = this.targetY;
        this.phase = 'idle';
        this.velocity.x = 0;
        this.velocity.y = 0;
      }
    }

    if (this.phase === 'wave') {
      const waveY = Math.sin(time * 0.003 + this.waveOffset) * this.waveAmplitude;
      this.x = this.targetX;
      this.y = this.targetY + waveY;
      this.glowIntensity = 0.5 + Math.abs(Math.sin(time * 0.003 + this.waveOffset)) * 0.5;
      this.size = this.baseSize + Math.abs(Math.sin(time * 0.003 + this.waveOffset)) * 2;
    }

    if (this.phase === 'breathe') {
      const breatheScale = 1 + Math.sin(time * 0.002 + this.breatheOffset) * 0.15;
      const dx = this.targetX - this.breatheCenterX;
      const dy = this.targetY - this.breatheCenterY;
      this.x = this.breatheCenterX + dx * breatheScale;
      this.y = this.breatheCenterY + dy * breatheScale;
      this.glowIntensity = 0.4 + Math.sin(time * 0.002 + this.breatheOffset) * 0.3;
      this.size = this.baseSize + Math.sin(time * 0.0015 + this.breatheOffset) * 1.5;
    }

    if (this.phase === 'idle') {
      // Subtle floating
      this.x = this.targetX + Math.sin(time * 0.001 + this.waveOffset) * 0.5;
      this.y = this.targetY + Math.cos(time * 0.0012 + this.waveOffset) * 0.5;
      this.glowIntensity = 0.4 + Math.sin(time * 0.002 + this.waveOffset) * 0.15;
    }
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = this.opacity;

    // Outer glow
    const gradient = ctx.createRadialGradient(
      this.x, this.y, 0,
      this.x, this.y, this.size * 4
    );
    gradient.addColorStop(0, `rgba(255,255,255,${0.8 * this.glowIntensity})`);
    gradient.addColorStop(0.3, `rgba(255,255,255,${0.2 * this.glowIntensity})`);
    gradient.addColorStop(0.6, `rgba(255,255,255,${0.05 * this.glowIntensity})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');

    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size * 4, 0, Math.PI * 2);
    ctx.fill();

    // Core dot
    ctx.fillStyle = `rgba(255,255,255,${0.9 * this.opacity})`;
    ctx.beginPath();
    // Slightly rounded square for core
    const s = this.size;
    const r = s * 0.3;
    ctx.moveTo(this.x - s + r, this.y - s);
    ctx.arcTo(this.x + s, this.y - s, this.x + s, this.y + s, r);
    ctx.arcTo(this.x + s, this.y + s, this.x - s, this.y + s, r);
    ctx.arcTo(this.x - s, this.y + s, this.x - s, this.y - s, r);
    ctx.arcTo(this.x - s, this.y - s, this.x + s, this.y - s, r);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}

// ── Get positions for text particles ──
export function getTextParticlePositions(text, fontSize, letterSpacing, canvasWidth, canvasHeight) {
  const offscreen = document.createElement('canvas');
  const ctx = offscreen.getContext('2d');
  offscreen.width = canvasWidth;
  offscreen.height = canvasHeight;

  ctx.fillStyle = '#FFFFFF';
  ctx.font = `100 ${fontSize}px Inter, sans-serif`;
  ctx.letterSpacing = `${letterSpacing}px`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, canvasWidth / 2, canvasHeight / 2);

  const imageData = ctx.getImageData(0, 0, canvasWidth, canvasHeight);
  const pixels = imageData.data;
  const positions = [];
  const gap = 6; // Sample every 6 pixels for particle density

  for (let y = 0; y < canvasHeight; y += gap) {
    for (let x = 0; x < canvasWidth; x += gap) {
      const i = (y * canvasWidth + x) * 4;
      if (pixels[i + 3] > 128) {
        positions.push({ x, y });
      }
    }
  }

  return positions;
}

// ── Get grid positions ──
export function getGridPositions(gridSize, spacing, centerX, centerY) {
  const positions = [];
  const totalWidth = (gridSize - 1) * spacing;
  const totalHeight = (gridSize - 1) * spacing;
  const startX = centerX - totalWidth / 2;
  const startY = centerY - totalHeight / 2;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      positions.push({
        x: startX + col * spacing,
        y: startY + row * spacing,
        row,
        col,
      });
    }
  }

  return positions;
}
