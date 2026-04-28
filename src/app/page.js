'use client';

import { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import CometEntry from '@/components/CometEntry';
import ReactiveGrid from '@/components/ReactiveGrid';

export default function Home() {
  const [phase, setPhase] = useState('comet'); // 'comet' | 'grid'

  const handleCometComplete = useCallback(() => {
    setPhase('grid');
  }, []);

  return (
    <main
      style={{
        width: '100vw',
        height: '100vh',
        background: '#000000',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <AnimatePresence mode="wait">
        {phase === 'comet' && (
          <CometEntry key="comet" onComplete={handleCometComplete} />
        )}
      </AnimatePresence>

      {phase === 'grid' && (
        <ReactiveGrid key="grid" />
      )}
    </main>
  );
}
