'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import LiquidOrb from './LiquidOrb';
import styles from './Dashboard.module.css';
import { 
  ArrowUp, 
  Settings, 
  BookOpen, 
  Activity, 
  Sparkles, 
  Plus, 
  Image, 
  Mic, 
  PlusCircle, 
  User 
} from 'lucide-react';

export default function Dashboard() {
  const [isSidebarExpanded, setIsSidebarExpanded] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const chatEndRef = useRef(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = () => {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { role: 'user', text: input }]);
    setInput('');
    setIsThinking(true);
    setTimeout(() => {
      setIsThinking(false);
      setMessages(prev => [...prev, { role: 'aarya', text: 'fikr mat kar, sab theek ho jayega.' }]);
    }, 1500);
  };

  const resetChat = () => {
    setMessages([]);
  };

  const pastVibes = [
    'Kal ki baatein',
    'Outfit planning',
    'Chai thoughts',
    'Late night vent'
  ];

  return (
    <motion.div 
      className={styles.container}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 2, ease: 'easeOut' }}
    >
      {/* Background Layer */}
      <div className={styles.background} aria-hidden="true">
        <div className={styles.orbGlow} />
      </div>

      {/* ── Left Sidebar: Memory Drawer ── */}
      <motion.aside 
        className={styles.sidebar}
        onMouseEnter={() => setIsSidebarExpanded(true)}
        onMouseLeave={() => setIsSidebarExpanded(false)}
        animate={{ width: isSidebarExpanded ? 250 : 68 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      >
        <div className={styles.sidebarTop}>
          <motion.button 
            className={styles.newChatBtn}
            animate={{ width: isSidebarExpanded ? '100%' : 40, padding: isSidebarExpanded ? '10px 16px' : '10px' }}
            onClick={resetChat}
          >
            <Plus size={18} strokeWidth={1.5} />
            {isSidebarExpanded && <span className={styles.btnText}>New Chat</span>}
          </motion.button>
        </div>

        <div className={styles.historyList}>
          {isSidebarExpanded && <p className={styles.sidebarLabel}>Past Vibes</p>}
          {pastVibes.map((vibe, i) => (
            <button key={i} className={styles.historyItem}>
              <BookOpen size={16} strokeWidth={1.2} />
              {isSidebarExpanded && <span className={styles.vibeText}>{vibe}</span>}
            </button>
          ))}
        </div>
      </motion.aside>

      {/* ── Fixed Global Navbar ── */}
      <header className={styles.navbar}>
        <div className={styles.brand}>AARYA</div>
        
        {/* Reset / New Badge in Center */}
        <div className={styles.navCenter}>
          <button className={styles.newBadge} onClick={resetChat} aria-label="Reset Conversation">
            <PlusCircle size={14} strokeWidth={1.5} />
            <span>RESET</span>
          </button>
        </div>

        <div className={styles.navActions}>
          <button className={styles.navIcon} aria-label="Memory"><BookOpen size={18} strokeWidth={1} /></button>
          <button className={styles.navIcon} aria-label="Pulse"><Activity size={18} strokeWidth={1} /></button>
          <button className={styles.navIcon} aria-label="Profile"><User size={18} strokeWidth={1} /></button>
          <button className={styles.navIcon} aria-label="Settings"><Settings size={18} strokeWidth={1} /></button>
        </div>
      </header>

      {/* ── Main content ── */}
      <main className={styles.main}>
        <div className={styles.anchorWrapper}>
          <div className={styles.orbHitbox}>
            <LiquidOrb size={42} spark />
          </div>
          <motion.div 
            className={styles.greetingWrapper}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 1.2 }}
          >
            <h2 className={styles.greeting}>I'm here, Behen.</h2>
            <p className={styles.subGreeting}>hum yahi hain, hamesha...</p>
          </motion.div>
        </div>

        {/* Chat Area */}
        <div className={`${styles.chatWindow} custom-scroll`}>
          <AnimatePresence>
            {messages.map((m, i) => (
              <motion.div 
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className={styles.messageRow}
              >
                <p className={`${styles.message} ${m.role === 'aarya' ? styles.aarya : styles.user}`}>
                  {m.text}
                </p>
              </motion.div>
            ))}
          </AnimatePresence>
          <div ref={chatEndRef} />
        </div>
      </main>

      {/* ── Enhanced Chat Input ── */}
      <footer className={styles.footer}>
        <div className={styles.capsule}>
          <button className={styles.inputAction} aria-label="Upload Image">
            <Image size={16} strokeWidth={1.5} />
          </button>
          <button className={styles.inputAction} aria-label="Voice Message">
            <Mic size={16} strokeWidth={1.5} />
          </button>
          
          <input 
            type="text" 
            placeholder="Bol behen, kya chal raha hai?" 
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          />
          
          <button onClick={handleSend} className={styles.sendBtn} aria-label="Send message">
            <ArrowUp size={18} strokeWidth={1.5} />
          </button>
        </div>
      </footer>
    </motion.div>
  );
}
