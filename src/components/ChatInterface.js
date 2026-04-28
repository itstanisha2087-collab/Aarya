'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import styles from './ChatInterface.module.css';

const SAMPLE_RESPONSES = [
  "I understand. Let me process that for you.",
  "Analyzing your request. One moment...",
  "I've considered multiple approaches. Here's what I recommend.",
  "That's an interesting perspective. Let me expand on it.",
  "Processing complete. Here are my findings.",
];

export default function ChatInterface({ onClose }) {
  const [messages, setMessages] = useState([
    {
      id: '0',
      role: 'ai',
      text: 'Hello. I am AARYA. How can I assist you?',
      timestamp: Date.now(),
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    // Auto-focus input when chat opens
    setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 600);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text) return;

    const userMsg = {
      id: Date.now().toString(),
      role: 'user',
      text,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setIsTyping(true);

    // Simulate AI response
    setTimeout(() => {
      const response = SAMPLE_RESPONSES[Math.floor(Math.random() * SAMPLE_RESPONSES.length)];
      const aiMsg = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        text: response,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, aiMsg]);
      setIsTyping(false);
    }, 1200 + Math.random() * 1000);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <motion.div
      className={styles.chatContainer}
      initial={{ opacity: 0, y: 40, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.98 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
    >
      {/* Chat Header */}
      <div className={styles.chatHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.headerDot} />
          <span className={styles.headerTitle}>AARYA</span>
        </div>
        <button
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close chat"
          id="chat-close-btn"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Messages Area */}
      <div className={styles.messagesArea}>
        {messages.map((msg, index) => (
          <motion.div
            key={msg.id}
            className={`${styles.message} ${msg.role === 'user' ? styles.messageUser : styles.messageAi}`}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.5,
              delay: index === messages.length - 1 ? 0.1 : 0,
              ease: [0.22, 1, 0.36, 1],
            }}
          >
            <div className={`${styles.messageBubble} ${msg.role === 'user' ? styles.bubbleUser : styles.bubbleAi}`}>
              {msg.text}
            </div>
          </motion.div>
        ))}

        {isTyping && (
          <motion.div
            className={`${styles.message} ${styles.messageAi}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
          >
            <div className={`${styles.messageBubble} ${styles.bubbleAi}`}>
              <div className={styles.typingDots}>
                <span className={styles.dot} />
                <span className={styles.dot} />
                <span className={styles.dot} />
              </div>
            </div>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className={styles.inputArea}>
        <div className={styles.inputWrapper}>
          <input
            ref={inputRef}
            type="text"
            className={styles.chatInput}
            placeholder="Type your message..."
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            id="chat-input-field"
          />
          <button
            className={`${styles.sendBtn} ${inputValue.trim() ? styles.sendBtnActive : ''}`}
            onClick={handleSend}
            disabled={!inputValue.trim()}
            aria-label="Send message"
            id="chat-send-btn"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <span className={styles.inputHint}>esc to close</span>
      </div>
    </motion.div>
  );
}
