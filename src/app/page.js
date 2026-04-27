'use client';

import { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import IntroAnimation from '@/components/IntroAnimation';
import Dashboard from '@/components/Dashboard';

export default function Home() {
  const [phase, setPhase] = useState('intro'); // 'intro' | 'dashboard'

  return (
    <main
      style={{
        width: '100vw',
        height: '100vh',
        background: 'linear-gradient(135deg, #0F172A 0%, #13172B 50%, #0F172A 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <AnimatePresence mode="wait">
        {phase === 'intro' ? (
          <IntroAnimation key="intro" onComplete={() => setPhase('dashboard')} />
        ) : (
          <Dashboard key="dashboard" />
        )}
      </AnimatePresence>
    </main>
  );
}
