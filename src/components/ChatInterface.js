'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { sendMessageToAarya, transcribeAudio, sendHeartbeat, checkWakeStatus, scanMyScreen } from '@/lib/api';
import { speakText, stopSpeaking, setVoiceEnabled, isVoiceEnabled, onPlaybackStateChange } from '@/lib/voice';
import { startWakeWord, stopWakeWord, isWakeWordSupported } from '@/lib/wakeWord';
import HistoryPanel from './HistoryPanel';
import styles from './ChatInterface.module.css';

// ── Web Audio API dual-pitch Jarvis chime generator ──
function playJarvisBeep() {
  if (typeof window === 'undefined') return;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    
    // First high-pitch chime (A5)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, ctx.currentTime);
    gain1.gain.setValueAtTime(0.0, ctx.currentTime);
    gain1.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
    gain1.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.25);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start();
    osc1.stop(ctx.currentTime + 0.25);

    // Second higher-pitch chime (C#6) delayed by 120ms
    setTimeout(() => {
      try {
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1100, ctx.currentTime);
        gain2.gain.setValueAtTime(0.0, ctx.currentTime);
        gain2.gain.linearRampToValueAtTime(0.15, ctx.currentTime + 0.05);
        gain2.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.3);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start();
        osc2.stop(ctx.currentTime + 0.3);
      } catch (e) {
        console.warn(e);
      }
    }, 120);
  } catch (e) {
    console.warn('[AARYA] Web Audio chime failed:', e);
  }
}

// ── Native HTML5 Notification Alert Fallback ──
function triggerWakeNotification() {
  if (typeof window === 'undefined') return;
  if (!('Notification' in window)) return;
  
  if (Notification.permission === 'granted') {
    const notification = new Notification("AARYA", {
      body: "Haan Ayush! I am listening. Bol, kya chal raha hai? 🎙️",
      requireInteraction: false
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}

export default function ChatInterface() {
  // ── Core Chat State ──
  const [messages, setMessages] = useState([
    {
      id: 'welcome-0',
      role: 'ai',
      text: "What's up, Ayush! I am AARYA — your elite engineering partner. Let me know what complex systems we are building today.",
      timestamp: Date.now(),
      mood: 'neutral',
    },
  ]);
  const [inputValue, setInputValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // ── Voice State ──
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [wakeGlow, setWakeGlow] = useState(false);   // wake word detection glow

  // ── Dynamic Voice Settings States ──
  const [language, setLanguage] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aarya_language') || 'english';
    }
    return 'english';
  });
  
  const [voiceType, setVoiceType] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aarya_voice_type') || 'female';
    }
    return 'female';
  });

  // Persist selections across sessions
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('aarya_language', language);
    }
  }, [language]);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('aarya_voice_type', voiceType);
    }
  }, [voiceType]);

  const [voiceSpeed, setVoiceSpeed] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aarya_voice_speed') || 'fast';
    }
    return 'fast';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('aarya_voice_speed', voiceSpeed);
    }
  }, [voiceSpeed]);

  const [isSpeaking, setIsSpeaking] = useState(false);

  // Sync speech playback states to animate glowing voice orb and coordinate listener mute states
  useEffect(() => {
    onPlaybackStateChange((speaking) => {
      setIsSpeaking(speaking);
      // Notify backend speaking status asynchronously
      fetch('http://127.0.0.1:8000/api/playback-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_playing: speaking })
      }).catch(err => console.warn('[AARYA] Failed to sync playback state:', err));
    });
    return () => {
      onPlaybackStateChange(null);
    };
  }, []);

  // ── Input Mode Routing ──
  // Tracks whether the current interaction originated from voice or keyboard.
  // voiceModeRef mirrors isVoiceMode so async handlers read the non-stale value.
  const [isVoiceMode, setIsVoiceMode] = useState(false);
  const voiceModeRef = useRef(false);

  // Helper: set both state + ref atomically
  const activateVoiceMode = useCallback(() => {
    setIsVoiceMode(true);
    voiceModeRef.current = true;
  }, []);

  const deactivateVoiceMode = useCallback(() => {
    setIsVoiceMode(false);
    voiceModeRef.current = false;
  }, []);

  // ── Refs (stable, no leaks) ──
  const messagesEndRef   = useRef(null);
  const inputRef         = useRef(null);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef   = useRef([]);
  const streamRef        = useRef(null); // keep mic stream for cleanup



  // ══════════════════════════════════════════
  // SEND FLOW — handles both text & voice paths
  // overrideText is only set by the voice path;
  // manual sends never pass it.
  // ══════════════════════════════════════════
  const handleSend = useCallback(async (overrideText, fromVoice = false) => {
    // Halts any ongoing assistant speech immediately when a new prompt is submitted
    stopSpeaking();

    const text = (overrideText ?? inputValue).trim();
    if (!text || loading) return;

    // ── Route: manual text → ensure voice mode is OFF ──
    // ── Route: voice call  → caller has already activated voice mode ──
    if (!fromVoice) {
      deactivateVoiceMode();
    }

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
      const data = await sendMessageToAarya(text, language, voiceType, voiceSpeed);
      await new Promise((r) => setTimeout(r, 400));

      // ── Phase 5: Use detailedText for screen rendering ──
      const aiMsg = {
        id: `ai-${Date.now()}`,
        role: 'ai',
        text: data.detailedText,   // rich markdown — displayed in chat
        timestamp: Date.now(),
        mood: data.mood,
      };
      setMessages((prev) => [...prev, aiMsg]);

      // ── Input Mode Router ──
      // Speak ONLY if this response originated from a voice interaction.
      // Phase 5+6: Use voiceSummary (clean spoken text) — never detailedText.
      if (voiceModeRef.current) {
        speakText(data.voiceSummary, data.audioBytes, language, voiceType, voiceSpeed);  // short, clean, spoken Hinglish
        deactivateVoiceMode();          // reset after speaking
      }

    } catch (err) {
      const errorMsg = {
        id: `err-${Date.now()}`,
        role: 'ai',
        text: 'Yaar connection toot gaya… backend check kar ya thodi der baad try kar.',
        timestamp: Date.now(),
        mood: 'error',
        isError: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
      deactivateVoiceMode(); // always reset on error
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [inputValue, loading, deactivateVoiceMode, language, voiceType]);

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ══════════════════════════════════════════
  // VOICE RECORDING FLOW
  // ══════════════════════════════════════════
  const startRecording = useCallback(async () => {
    // Halts any ongoing assistant speech immediately when the user taps to record
    stopSpeaking();

    if (isRecording || mediaRecorderRef.current) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      streamRef.current = stream;

      // Determine best supported MIME type
      const mimeType =
        MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' :
        MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' :
        MediaRecorder.isTypeSupported('audio/ogg') ? 'audio/ogg' :
        '';

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const chunks = audioChunksRef.current;
        audioChunksRef.current = [];

        if (chunks.length === 0) return;

        const blob = new Blob(chunks, { type: mimeType || 'audio/webm' });
        const filename = `recording.${mimeType?.includes('ogg') ? 'ogg' : 'webm'}`;

        // Stop & release mic stream
        if (streamRef.current) {
          streamRef.current.getTracks().forEach(t => t.stop());
          streamRef.current = null;
        }
        mediaRecorderRef.current = null;

        // Transcribe
        setIsTranscribing(true);
        try {
          const transcribedText = await transcribeAudio(blob, filename, language);
          if (transcribedText?.trim()) {
            // ── Voice mode must be active before handleSend is called ──
            // activateVoiceMode() was already called when recording started
            // (or by the wake word callback), so voiceModeRef.current = true here.
            setInputValue(transcribedText);
            setTimeout(() => {
              handleSend(transcribedText, /* fromVoice */ true);
            }, 50);
          } else {
            // Empty transcription — reset voice mode cleanly
            deactivateVoiceMode();
          }
        } catch (err) {
          console.warn('[ChatInterface] Transcription error handled gracefully:', err.message);
          deactivateVoiceMode();
        } finally {
          setIsTranscribing(false);
        }
      };

      recorder.start(250); // collect data in 250ms chunks
      setIsRecording(true);

      // ── Activate voice mode when mic physically starts ──
      // (Also activated by wake word callback, this is a no-op in that path)
      activateVoiceMode();
      console.log('[ChatInterface] Recording started — voice mode ON');

    } catch (err) {
      console.error('[ChatInterface] Mic access error:', err.message);
      setIsRecording(false);
      if (err.name === 'NotAllowedError') {
        const errMsg = {
          id: `err-${Date.now()}`,
          role: 'ai',
          text: 'Microphone permission denied. Please allow microphone access in browser settings. 🔒',
          timestamp: Date.now(),
          mood: 'error',
          isError: true,
        };
        setMessages(prev => [...prev, errMsg]);
      }
    }
  }, [isRecording, handleSend, language]);

  const stopRecording = useCallback((silent = false) => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
    if (!silent) console.log('[ChatInterface] Recording stopped');
  }, []);

  const handleMicClick = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  // ── Voice Toggle ──
  const handleVoiceToggle = useCallback(() => {
    const newState = !voiceOn;
    setVoiceOn(newState);
    setVoiceEnabled(newState);
  }, [voiceOn]);

  // ── Vision Scan Mode ──
  const handleVisionScan = useCallback(async () => {
    // Halts any ongoing assistant speech immediately when the user taps vision scan
    stopSpeaking();

    if (loading || isRecording || isTranscribing) return;

    const customPrompt = inputValue.trim();
    const userMsgText = customPrompt ? `[Vision Scan] ${customPrompt}` : "[Vision Scan] Analyze my screen";

    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: userMsgText,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputValue('');
    setLoading(true);

    try {
      const data = await scanMyScreen(customPrompt, language, voiceType, voiceSpeed);
      await new Promise((r) => setTimeout(r, 400));

      const aiMsg = {
        id: `ai-${Date.now()}`,
        role: 'ai',
        text: data.detailedText,
        timestamp: Date.now(),
        mood: data.mood || 'neutral',
      };
      setMessages((prev) => [...prev, aiMsg]);

      if (voiceOn && data.voiceSummary) {
        speakText(data.voiceSummary, data.audioBytes, language, voiceType, voiceSpeed);
      }
    } catch (err) {
      const errorMsg = {
        id: `err-${Date.now()}`,
        role: 'ai',
        text: 'Yaar screen capture ya vision analysis fail ho gaya... backend logs check kar.',
        timestamp: Date.now(),
        mood: 'error',
        isError: true,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [inputValue, loading, isRecording, isTranscribing, language, voiceType, voiceSpeed, voiceOn]);

  // ── Mood indicator color ──
  const getMoodColor = (mood) => {
    switch (mood) {
      case 'stressed': return 'rgba(255, 180, 100, 0.6)';
      case 'angry':    return 'rgba(255, 100, 100, 0.6)';
      case 'happy':    return 'rgba(100, 255, 150, 0.6)';
      case 'sad':      return 'rgba(120, 140, 255, 0.6)';
      case 'error':    return 'rgba(255, 80, 80, 0.6)';
      default:         return 'rgba(255, 255, 255, 0.3)';
    }
  };

  // ── Determine mic button state class ──
  const micBtnClass = [
    styles.micBtn,
    isRecording   ? styles.micBtnActive   : '',
    wakeGlow      ? styles.micBtnWakeGlow : '',
    isTranscribing ? styles.micBtnTranscribing : '',
  ].filter(Boolean).join(' ');

  // ── Auto-focus on mount ──
  useEffect(() => {
    const timer = setTimeout(() => {
      if (inputRef.current) inputRef.current.focus();
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // ── Scroll to bottom on new messages ──
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Request Notification Permissions on Mount ──
  useEffect(() => {
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // ── Wake Word: DISABLED in Electron ──
  // Browser-based SpeechRecognition does not work inside Electron (constant 'network' errors)
  // and causes mic contention with the Python desktop_listener.py which is the production
  // wake word detection path. The Electron/backend IPC pipeline handles wake activation.
  // If running in a standalone browser (not Electron), re-enable this block.
  useEffect(() => {
    // Detect if running inside Electron
    const isElectron = typeof window !== 'undefined' && window.electron;
    if (isElectron) {
      console.log('[ChatInterface] Running inside Electron — browser wake word DISABLED (Python listener handles wake).');
      return;
    }

    // Browser-only fallback: use SpeechRecognition if available
    if (!isWakeWordSupported()) return;

    const isAppActive = isRecording || isTranscribing || loading || isVoiceMode;

    if (isAppActive) {
      console.log('[ChatInterface] App is active. Suspending passive wake-word detection.');
      stopWakeWord();
    } else {
      console.log('[ChatInterface] App is idle. Initializing/Resuming passive wake-word detection...');
      
      startWakeWord((phrase) => {
        console.log(`[ChatInterface] Wake word detected: "${phrase}"`);
        playJarvisBeep();
        activateVoiceMode();
        setWakeGlow(true);
        setTimeout(() => setWakeGlow(false), 3000);

        if (typeof window !== 'undefined' && window.electron && window.electron.wakeWindow) {
          window.electron.wakeWindow();
        } else {
          try { window.focus(); } catch (_) {}
          triggerWakeNotification();
        }

        setTimeout(() => { startRecording(); }, 800);
      });
    }

    return () => { stopWakeWord(); };
  }, [isRecording, isTranscribing, loading, isVoiceMode, activateVoiceMode, startRecording, language, voiceType, voiceSpeed]);

  // ── Cleanup mic stream and recorder on unmount ──
  useEffect(() => {
    return () => {
      stopRecording(/* silent */ true);
      stopSpeaking();
      stopWakeWord();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopRecording]);

  // ── Ambient Assistant Listeners (from Electron) ──
  useEffect(() => {
    if (typeof window === 'undefined' || !window.electronAPI) return;

    console.log('[ChatInterface] Subscribing to Electron ambient and stop-speech event listeners.');

    const unsubscribeAmbient = window.electronAPI.onAmbientResponse((data) => {
      console.log('[ChatInterface] Received ambient response event from Electron:', data);
      
      // Stop any ongoing speech before processing new one
      stopSpeaking();

      // Create message objects for the user and assistant
      const userMsg = {
        id: `user-${Date.now()}`,
        role: 'user',
        text: data.query,
        timestamp: Date.now(),
      };
      
      const aiMsg = {
        id: `ai-${Date.now() + 1}`,
        role: 'ai',
        text: data.detailedText,
        timestamp: Date.now(),
        mood: data.mood || 'neutral',
      };

      setMessages((prev) => [...prev, userMsg, aiMsg]);

      // Speak the voice summary (since ambient mode is a background voice response, we always read it)
      if (data.voiceSummary) {
        speakText(data.voiceSummary, data.audio_bytes || data.audioBytes, language, voiceType, voiceSpeed);
      }
    });

    const unsubscribeStop = window.electronAPI.onStopSpeech(() => {
      console.log('[ChatInterface] Received global stop speech signal.');
      stopSpeaking();
    });

    const unsubscribeWake = window.electronAPI.onWake((value) => {
      console.log('[ChatInterface] Received window wake event:', value);
      playJarvisBeep();
      setWakeGlow(true);
      setTimeout(() => setWakeGlow(false), 3000);
    });

    return () => {
      if (unsubscribeAmbient) unsubscribeAmbient();
      if (unsubscribeStop) unsubscribeStop();
      if (unsubscribeWake) unsubscribeWake();
    };
  }, [language, voiceType, voiceSpeed]);

  // ── Desktop Runtime Auto-Connect & Heartbeat ──
  useEffect(() => {
    // 1. Initial Heartbeat + Interval (every 5 seconds)
    sendHeartbeat();
    const heartbeatInterval = setInterval(() => {
      sendHeartbeat();
    }, 5000);

    // 2. URL Parameter Query hook (?wake=true) on mount
    const timer = setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      if (params.get('wake') === 'true') {
        console.log('[AARYA/Desktop] Auto-wake from desktop launch parameter detected.');
        activateVoiceMode();
        setWakeGlow(true);
        setTimeout(() => setWakeGlow(false), 3000);
        setTimeout(() => {
          startRecording();
        }, 800);

        // Sanitize the URL immediately
        const cleanUrl = new URL(window.location.href);
        cleanUrl.searchParams.delete('wake');
        window.history.replaceState({}, document.title, cleanUrl.pathname + cleanUrl.search);
      }
    }, 1000); // slight delay to ensure browser mic audio context is ready

    return () => {
      clearInterval(heartbeatInterval);
      clearTimeout(timer);
    };
  }, [activateVoiceMode, startRecording]);

  return (
    <div className={styles.chatWrapper}>

      {/* ── Cinematic Ambient Waking Overlay ── */}
      <AnimatePresence>
        {wakeGlow && (
          <motion.div
            className={styles.wakeOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className={styles.glowingHalo} />
            <motion.div
              className={styles.wakeOrb}
              initial={{ scale: 0.3, opacity: 0 }}
              animate={{ scale: [1, 1.1, 1], opacity: 1 }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "easeInOut" }}
            >
              <div className={styles.wakeOrbCore} />
              <div className={styles.wakeOrbRing} />
            </motion.div>
            <motion.h2
              className={styles.wakeTitle}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
            >
              AARYA ACTIVATED
            </motion.h2>
            <p className={styles.wakeSub}>Listening actively, Ayush. Go ahead... 🎙️</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Listening/Speaking Voice Orb ── */}
      <AnimatePresence>
        {(isRecording || isTranscribing || isSpeaking) && (
          <motion.div
            className={styles.voiceOrbContainer}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className={isTranscribing ? styles.voiceOrbTranscribing : isSpeaking ? styles.voiceOrbSpeaking : styles.voiceOrb}>
              <div className={styles.voiceOrbCore} />
              <div className={styles.voiceOrbRing1} />
              <div className={styles.voiceOrbRing2} />
            </div>
            <span className={styles.voiceOrbLabel}>
              {isTranscribing ? 'processing…' : isSpeaking ? 'speaking…' : 'listening…'}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Chat Header ── */}
      <div className={styles.chatHeader}>
        <div className={styles.headerLeft}>
          <span className={styles.headerDot} />
          <span className={styles.headerTitle}>AARYA</span>
          <span className={styles.headerSubtitle}>• your safe space</span>
        </div>
        <div className={styles.headerRight}>
          {/* Voice Toggle */}
          <button
            className={`${styles.headerBtn} ${voiceOn ? styles.headerBtnVoiceOn : ''}`}
            onClick={handleVoiceToggle}
            aria-label={voiceOn ? 'Disable voice' : 'Enable voice'}
            id="voice-toggle-btn"
            title={voiceOn ? 'Voice ON — click to mute' : 'Voice OFF — click to unmute'}
          >
            {voiceOn ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
              </svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                <line x1="23" y1="9" x2="17" y2="15"/>
                <line x1="17" y1="9" x2="23" y2="15"/>
              </svg>
            )}
          </button>
          {/* History */}
          <button
            className={styles.historyBtn}
            onClick={() => setShowHistory(true)}
            aria-label="View history"
            id="history-toggle-btn"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>

          {/* Native Window Controls */}
          {typeof window !== 'undefined' && window.ipcRenderer && (
            <div className={styles.windowControls}>
              {/* Minimize */}
              <button
                className={styles.winControlBtn}
                onClick={() => window.ipcRenderer.send('minimize-window-req')}
                title="Minimize"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              {/* Maximize */}
              <button
                className={styles.winControlBtn}
                onClick={() => window.ipcRenderer.send('maximize-window-req')}
                title="Maximize"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                </svg>
              </button>
              {/* Close (Minimize to Tray) */}
              <button
                className={`${styles.winControlBtn} ${styles.winControlBtnClose}`}
                onClick={() => window.ipcRenderer.send('close-window-req')}
                title="Close to Tray"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          )}
        </div>
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
              {msg.role === 'ai' && !msg.isError ? (
                <div className="message-text">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {msg.text}
                  </ReactMarkdown>
                </div>
              ) : (
                msg.text
              )}
            </div>
          </motion.div>
        ))}

        {/* ── Typing Indicator ── */}
        <AnimatePresence>
          {(loading || isTranscribing) && (
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
        {/* ── Premium Glassmorphism Voice Controls ── */}
        <div className={styles.voiceSettingsBar}>
          <div className={styles.voiceSelectContainer}>
            <span className={styles.voiceSelectLabel}>Language</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className={styles.voiceSelect}
              id="voice-language-selector"
              disabled
            >
              <option value="english">English (India)</option>
            </select>
          </div>

          <div className={styles.voiceSelectContainer}>
            <span className={styles.voiceSelectLabel}>Voice</span>
            <select
              value={voiceType}
              onChange={(e) => setVoiceType(e.target.value)}
              className={styles.voiceSelect}
              id="voice-gender-selector"
            >
              <option value="female">Female</option>
              <option value="male">Male</option>
            </select>
          </div>

          <div className={styles.voiceSelectContainer}>
            <span className={styles.voiceSelectLabel}>Speed</span>
            <select
              value={voiceSpeed}
              onChange={(e) => setVoiceSpeed(e.target.value)}
              className={styles.voiceSelect}
              id="voice-speed-selector"
            >
              <option value="normal">Normal</option>
              <option value="fast">Fast</option>
              <option value="gemini live">Gemini Live</option>
            </select>
          </div>

          <button
            className={styles.visionBtn}
            onClick={handleVisionScan}
            disabled={loading || isRecording || isTranscribing}
            id="vision-scan-btn"
            title="Scan current screen and get AI insight"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ marginRight: '6px' }}>
              <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
            Scan My Screen
          </button>
        </div>

        <div className={`${styles.inputPill} ${isRecording ? styles.inputPillRecording : ''}`}>
          <input
            ref={inputRef}
            type="text"
            className={styles.chatInput}
            placeholder={isRecording ? 'Listening…' : 'Bol, kya chal raha hai…'}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={loading || isRecording || isTranscribing}
            id="chat-input-field"
            autoComplete="off"
          />

          {/* ── Mic Button ── */}
          <button
            className={micBtnClass}
            onClick={handleMicClick}
            disabled={isTranscribing}
            aria-label={isRecording ? 'Stop recording' : 'Start voice input'}
            id="voice-mic-btn"
            title={isRecording ? 'Tap to stop' : 'Tap to speak'}
          >
            {isRecording ? (
              /* Stop icon when recording */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="2" />
              </svg>
            ) : (
              /* Mic icon when idle */
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            )}

            {/* Pulse ring shown while recording */}
            {isRecording && <span className={styles.micPulseRing} />}
          </button>

          {/* ── Send Button ── */}
          <button
            className={`${styles.sendBtn} ${inputValue.trim() && !loading ? styles.sendBtnActive : ''}`}
            onClick={() => handleSend()}
            disabled={!inputValue.trim() || loading || isRecording}
            aria-label="Send message"
            id="chat-send-btn"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </button>
        </div>
        <span className={styles.inputHint}>
          {isRecording
            ? 'tap mic to stop'
            : isTranscribing
            ? 'transcribing…'
            : 'enter to send · mic to speak'}
        </span>
      </div>

      {/* ── History Panel ── */}
      <AnimatePresence>
        {showHistory && (
          <HistoryPanel onClose={() => setShowHistory(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}
