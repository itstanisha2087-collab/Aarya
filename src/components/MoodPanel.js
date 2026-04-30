'use client';

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchAaryaResponse } from '@/lib/api';
import styles from './MoodPanel.module.css';

const MOODS = [
  { value: 'stressed', label: 'Stressed', icon: '😮‍💨' },
  { value: 'happy', label: 'Happy', icon: '😊' },
  { value: 'tired', label: 'Tired', icon: '😴' },
  { value: 'angry', label: 'Angry', icon: '😤' },
];

export default function MoodPanel() {
  const [responseText, setResponseText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedMood, setSelectedMood] = useState('stressed');
  const [hasResponded, setHasResponded] = useState(false);

  const handleCheckMood = useCallback(async () => {
    setLoading(true);
    setError('');
    setResponseText('');

    try {
      const text = await fetchAaryaResponse(selectedMood);
      setResponseText(text);
      setHasResponded(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [selectedMood]);

  return (
    <motion.div
      className={styles.panel}
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
    >
      {/* Panel Header */}
      <div className={styles.header}>
        <div className={styles.headerDot} />
        <span className={styles.headerLabel}>SYSTEM LINK</span>
        <div className={styles.headerLine} />
      </div>

      {/* Mood Selector */}
      <div className={styles.moodSelector}>
        {MOODS.map((mood) => (
          <button
            key={mood.value}
            className={`${styles.moodChip} ${selectedMood === mood.value ? styles.moodChipActive : ''}`}
            onClick={() => setSelectedMood(mood.value)}
            id={`mood-chip-${mood.value}`}
          >
            <span className={styles.moodIcon}>{mood.icon}</span>
            <span className={styles.moodLabel}>{mood.label}</span>
          </button>
        ))}
      </div>

      {/* Response Area */}
      <div className={styles.responseArea}>
        <AnimatePresence mode="wait">
          {loading && (
            <motion.div
              key="loading"
              className={styles.thinkingState}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className={styles.thinkingDots}>
                <span className={styles.dot} style={{ animationDelay: '0s' }} />
                <span className={styles.dot} style={{ animationDelay: '0.2s' }} />
                <span className={styles.dot} style={{ animationDelay: '0.4s' }} />
              </div>
              <span className={styles.thinkingText}>Aarya is thinking...</span>
            </motion.div>
          )}

          {!loading && responseText && (
            <motion.p
              key="response"
              className={styles.responseText}
              initial={{ opacity: 0, y: 10, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
            >
              &ldquo;{responseText}&rdquo;
            </motion.p>
          )}

          {!loading && error && (
            <motion.p
              key="error"
              className={styles.errorText}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4 }}
            >
              {error}
            </motion.p>
          )}

          {!loading && !responseText && !error && (
            <motion.p
              key="idle"
              className={styles.idleText}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.3 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              Select a mood and tap the button below
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      {/* Action Button */}
      <motion.button
        className={styles.actionBtn}
        onClick={handleCheckMood}
        disabled={loading}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.97 }}
        id="check-mood-btn"
      >
        <span className={styles.btnGlow} />
        <span className={styles.btnText}>
          {loading ? 'Connecting...' : hasResponded ? 'Ask Again' : 'Check Mood'}
        </span>
      </motion.button>

      {/* Connection Status */}
      <div className={styles.connectionStatus}>
        <div className={`${styles.connDot} ${hasResponded ? styles.connDotLive : ''}`} />
        <span className={styles.connLabel}>
          {hasResponded ? 'AARYA BRAIN CONNECTED' : 'AWAITING HANDSHAKE'}
        </span>
      </div>
    </motion.div>
  );
}
