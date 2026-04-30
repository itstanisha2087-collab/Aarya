'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { sendMessageToAarya } from '@/lib/api';
import HistoryPanel from './HistoryPanel';
import VoiceReactiveSphere from './VoiceReactiveSphere';
import styles from './ChatInterface.module.css';

export default function ChatInterface() {
  const [messages, setMessages] = useState([
    {
      id: 'welcome-0',
      role: 'ai',
      text: 'Aur Ayush bhai! Main hoon AARYA — tera apna AI bestie. Bol, kya chal raha hai?',
      timestamp: Date.now(),
      mood: 'neutral',
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  // Auto-focus input on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async () => {
    const text = inputValue.trim();
    if (!text || loading) return;

    // 1. Optimistic UI — add user message instantly
    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setLoading(true);

    try {
      // 2. Call backend
      const data = await sendMessageToAarya(text);

      // 3. Add AARYA response with slight delay for natural feel
      await new Promise((r) => setTimeout(r, 400));

      const aiMsg = {
        id: `ai-${Date.now()}`,
        role: 'ai',
        text: data.aarya,
        timestamp: Date.now(),
        mood: data.mood,
      };
      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      // Error response
      const errorMsg = {
        id: `err-${Date.now()}`,
        role: 'ai',
        text: 'Yaar connection toot gaya… backend check kar ya thodi der baad try kar.',
        timestamp: Date.now(),
        mood: 'error',
        isError: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      // Re-focus input
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [inputValue, loading]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Mood indicator color
  const getMoodColor = (mood) => {
    switch (mood) {
      case 'stressed': return 'rgba(255, 180, 100, 0.6)';
      case 'angry': return 'rgba(255, 100, 100, 0.6)';
      case 'happy': return 'rgba(100, 255, 150, 0.6)';
      case 'sad': return 'rgba(120, 140, 255, 0.6)';
      case 'error': return 'rgba(255, 80, 80, 0.6)';
      default: return 'rgba(255, 255, 255, 0.3)';
    }
  };

  return (
    <div className={styles.chatWrapper}>
      {/* ── Chat Header ── */}
      <div className={styles.chatHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.headerDot} />
          <span className={styles.headerTitle}>AARYA</span>
          <span className={styles.headerSubtitle}>• your safe space</span>
        </div>
        <button
          className={styles.historyBtn}
          onClick={() => setShowHistory(true)}
          aria-label="View history"
          id="history-toggle-btn"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </button>
      </div>

      {/* ── Messages Area ── */}
      <div className={styles.messagesArea} id="chat-messages-area">
        {messages.map((msg, index) => (
          <motion.div
            key={msg.id}
            className={`${styles.messageRow} ${msg.role === 'user' ? styles.messageRowUser : styles.messageRowAi}`}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: index === messages.length - 1 ? 0.08 : 0,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            {/* Mood indicator for AI messages */}
            {msg.role === 'ai' && msg.mood && (
              <div
                className={styles.moodDot}
                style={{ background: getMoodColor(msg.mood) }}
                title={`mood: ${msg.mood}`}
              />
            )}
            <div
              className={`${styles.bubble} ${
                msg.role === 'user' ? styles.bubbleUser : styles.bubbleAi
              } ${msg.isError ? styles.bubbleError : ''}`}
            >
              {msg.text}
            </div>
          </motion.div>
        ))}

        {/* ── Typing Indicator ── */}
        <AnimatePresence>
          {loading && (
            <motion.div
              className={`${styles.messageRow} ${styles.messageRowAi}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className={`${styles.bubble} ${styles.bubbleAi}`}>
                <div className={styles.typingDots}>
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                  <span className={styles.dot} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div ref={messagesEndRef} />
      </div>

      {/* ── Glassmorphism Input Bar ── */}
      <div className={styles.inputArea}>
        <div className={styles.inputPill}>
          <input
            ref={inputRef}
            type="text"
            className={styles.chatInput}
            placeholder="Bol, kya chal raha hai…"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading}
            id="chat-input-field"
            autoComplete="off"
          />
          <button
            className={`${styles.sendBtn} ${inputValue.trim() && !loading ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!inputValue.trim() || loading}
            aria-label="Send message"
            id="chat-send-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
          
          <button
            className={`${styles.voiceBtn} ${isVoiceActive ? styles.voiceBtnActive : ''}`}
            onClick={() => setIsVoiceActive(!isVoiceActive)}
            aria-label="Toggle Voice"
            id="chat-voice-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
              <line x1="12" y1="19" x2="12" y2="23"></line>
              <line x1="8" y1="23" x2="16" y2="23"></line>
            </svg>
          </button>
        </div>
        <span className={styles.inputHint}>enter to send • aarya listens</span>
      </div>

      {/* ── History Panel ── */}
      <AnimatePresence>
        {showHistory && (
          <HistoryPanel onClose={() => setShowHistory(false)} />
        )}
      </AnimatePresence>

      {/* ── Voice Reactive Sphere ── */}
      <VoiceReactiveSphere isListening={isVoiceActive} />
    </div>
  );
}
