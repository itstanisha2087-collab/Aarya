/**
 * AARYA Wake Word Detection — Singleton Module
 * Uses webkitSpeechRecognition (Chrome/Edge) for continuous passive listening.
 * 
 * Wake phrases: "hello aarya", "wake up aarya"
 * 
 * Usage:
 *   import { startWakeWord, stopWakeWord } from '@/lib/wakeWord';
 *   startWakeWord(() => { // triggered on wake word });
 *   stopWakeWord();
 */

const WAKE_PHRASES = ['hello aarya', 'wake up aarya', 'hey aarya', 'aarya'];

let recognition = null;
let isRunning = false;
let onDetectedCallback = null;
let shouldRestart = false;
let hasLoggedStart = false;

/**
 * Check if wake word detection is supported in this browser.
 * @returns {boolean}
 */
export function isWakeWordSupported() {
  return typeof window !== 'undefined' &&
    ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window);
}

/**
 * Start passive wake word detection.
 * Silently ignores if already running or unsupported.
 * 
 * @param {function} onDetected - Callback fired when a wake phrase is heard
 */
export function startWakeWord(onDetected) {
  if (typeof window === 'undefined') return;
  if (!isWakeWordSupported()) {
    console.warn('[AARYA/WakeWord] SpeechRecognition not supported in this browser.');
    return;
  }
  if (isRunning) {
    console.log('[AARYA/WakeWord] Already running — skipping duplicate start.');
    return;
  }

  onDetectedCallback = onDetected;
  shouldRestart = true;
  _createAndStart();
}

/**
 * Stop passive wake word detection cleanly.
 */
export function stopWakeWord() {
  shouldRestart = false;
  isRunning = false;
  hasLoggedStart = false;
  if (recognition) {
    try { recognition.abort(); } catch (_) {}
    recognition = null;
  }
  console.log('[AARYA/WakeWord] Stopped.');
}

/**
 * Internal: create a new recognition instance and start it.
 */
function _createAndStart() {
  if (!shouldRestart) return;

  const SpeechRecognition =
    window.webkitSpeechRecognition || window.SpeechRecognition;

  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = false; // Only process final results
  recognition.lang = 'en-US';
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    isRunning = true;
    if (!hasLoggedStart) {
      console.log('[AARYA/WakeWord] Passive listening started...');
      hasLoggedStart = true;
    }
  };

  recognition.onresult = (event) => {
    // Only look at the latest final result
    for (let i = event.resultIndex; i < event.results.length; i++) {
      if (!event.results[i].isFinal) continue;

      const transcript = event.results[i][0].transcript.toLowerCase().trim();
      console.log(`[AARYA/WakeWord] Heard: "${transcript}"`);

      const wakeDetected = WAKE_PHRASES.some(phrase => transcript.includes(phrase));
      if (wakeDetected) {
        console.log('[AARYA/WakeWord] 🚨 Wake word detected!');
        if (typeof onDetectedCallback === 'function') {
          onDetectedCallback(transcript);
        }
      }
    }
  };

  recognition.onerror = (event) => {
    // 'no-speech' and 'aborted' are expected — don't log as errors
    if (event.error === 'not-allowed') {
      console.warn('[AARYA/WakeWord] Microphone permission denied. Wake word disabled.');
      shouldRestart = false;
      isRunning = false;
      return;
    }
    if (event.error !== 'no-speech' && event.error !== 'aborted') {
      console.warn(`[AARYA/WakeWord] Error: ${event.error}`);
    }
  };

  recognition.onend = () => {
    isRunning = false;
    // Auto-restart to keep passive listening alive
    if (shouldRestart) {
      setTimeout(() => {
        if (shouldRestart) _createAndStart();
      }, 2000); // 2s delay to prevent rapid restart loops
    }
  };

  try {
    recognition.start();
  } catch (err) {
    console.warn('[AARYA/WakeWord] Could not start recognition:', err.message);
    isRunning = false;
    // Retry after delay
    if (shouldRestart) {
      setTimeout(() => _createAndStart(), 1500);
    }
  }
}
