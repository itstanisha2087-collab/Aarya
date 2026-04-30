'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { fetchChatHistory } from '@/lib/api';
import styles from './HistoryPanel.module.css';

export default function HistoryPanel({ onClose }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      setLoading(true);
      const data = await fetchChatHistory(30);
      if (!cancelled) {
        setConversations(data);
        setLoading(false);
      }
    }
    loadHistory();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const getMoodEmoji = (mood) => {
    const map = { stressed: '😮‍💨', angry: '😤', happy: '😊', sad: '😢' };
    return map[mood] || '💬';
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    const diff = Date.now() - new Date(ts).getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(ts).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  return (
    <motion.div className={styles.overlay} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }} onClick={onClose}>
      <motion.div className={styles.panel} initial={{ x: '100%', opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: '100%', opacity: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} onClick={(e) => e.stopPropagation()}>
        <div className={styles.panelHeader}>
          <div className={styles.panelHeaderLeft}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
            <span className={styles.panelTitle}>MEMORY</span>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close history" id="history-close-btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
        <div className={styles.conversationsList}>
          {loading && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>⏳</span>
              <p className={styles.emptyText}>Loading memories...</p>
            </div>
          )}
          {!loading && conversations.length === 0 && (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}>🧠</span>
              <p className={styles.emptyText}>No memories yet.</p>
              <p className={styles.emptySubtext}>Start chatting and I will remember everything.</p>
            </div>
          )}
          {!loading && conversations.map((conv, i) => (
            <motion.div key={conv.id || i} className={styles.convCard} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04, duration: 0.35 }}>
              <div className={styles.convHeader}>
                <span className={styles.convMoodEmoji}>{getMoodEmoji(conv.detected_mood)}</span>
                <span className={styles.convTime}>{formatTime(conv.timestamp)}</span>
              </div>
              <p className={styles.convUserMsg}>{conv.user_message}</p>
              <p className={styles.convAiMsg}>{conv.ai_response}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
