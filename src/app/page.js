'use client';

import { useState, useCallback } from 'react';
import { AnimatePresence } from 'framer-motion';
import IntroContainer from '@/components/intro/IntroContainer';
import ChatInterface from '@/components/ChatInterface';

export default function Home() {
  const [phase, setPhase] = useState('intro'); // 'intro' | 'chat'

  const handleIntroComplete = useCallback(() => {
    setPhase('chat');
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
        {phase === 'intro' && (
          <IntroContainer key="intro" onComplete={handleIntroComplete} />
        )}
      </AnimatePresence>

      {phase === 'chat' && (
        <ChatInterface key="chat" />
      )}
    </main>
  );
}
