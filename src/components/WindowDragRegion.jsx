'use client';

import { useEffect, useState } from 'react';

export default function WindowDragRegion() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '40px',
        zIndex: 9998,
        WebkitAppRegion: 'drag',
        userSelect: 'none',
      }}
    />
  );
}
