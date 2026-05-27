/**
 * AARYA Voice Utility — TTS (Text-to-Speech)
 * Uses the Web Speech API (SpeechSynthesis) — no npm packages required.
 * 
 * Usage:
 *   import { speakText, stopSpeaking, setVoiceEnabled } from '@/lib/voice';
 *   speakText("Hello Ayush!");
 */

let voiceEnabled = true;
let selectedVoice = null;

/**
 * Load and cache the preferred voice.
 * Prefers: English female voice (e.g. "Google UK English Female", "Samantha", "Victoria")
 */
function loadVoice() {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const tryLoad = () => {
    const voices = window.speechSynthesis.getVoices();
    if (!voices || voices.length === 0) return;

    // Priority: well-known natural female voices
    const femaleKeywords = ['female', 'woman', 'girl', 'samantha', 'victoria', 'karen', 'zira', 'aria', 'jenny', 'moira'];
    const enVoices = voices.filter(v => v.lang.startsWith('en'));

    // Try to find a named female voice first
    selectedVoice =
      enVoices.find(v => femaleKeywords.some(k => v.name.toLowerCase().includes(k))) ||
      enVoices.find(v => v.name.toLowerCase().includes('google')) ||
      enVoices[0] ||
      voices[0] ||
      null;

    if (selectedVoice) {
      console.log(`[AARYA/TTS] Voice selected: ${selectedVoice.name} (${selectedVoice.lang})`);
    }
  };

  // Voices may load async in some browsers
  tryLoad();
  if (!selectedVoice) {
    window.speechSynthesis.onvoiceschanged = () => {
      tryLoad();
      window.speechSynthesis.onvoiceschanged = null;
    };
  }
}

// Initialize on module load (client-side only)
if (typeof window !== 'undefined') {
  loadVoice();
}

/**
 * Speak the given text using SpeechSynthesis.
 * Cancels any ongoing speech first to prevent overlap.
 * 
 * @param {string} text - The text to speak
 * @param {object} options - Override defaults: { rate, pitch, volume }
 */
export function speakText(text, options = {}) {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  if (!voiceEnabled) return;
  if (!text || typeof text !== 'string') return;

  // Cancel any ongoing speech immediately
  window.speechSynthesis.cancel();

  // Strip markdown symbols for cleaner speech
  const cleanText = text
    .replace(/#{1,6}\s/g, '')       // headings
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold
    .replace(/\*(.+?)\*/g, '$1')     // italic
    .replace(/`{1,3}[^`]*`{1,3}/g, '') // code
    .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1') // links
    .replace(/^\s*[-*+]\s/gm, '')   // bullet points
    .replace(/---/g, '')             // horizontal rules
    .replace(/\n{2,}/g, '. ')       // paragraph breaks → pause
    .replace(/\n/g, ' ')
    .trim();

  if (!cleanText) return;

  const utterance = new SpeechSynthesisUtterance(cleanText);

  // Apply voice
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.lang = selectedVoice?.lang || 'en-US';

  // Settings
  utterance.rate   = options.rate   ?? 0.95;
  utterance.pitch  = options.pitch  ?? 1.05;
  utterance.volume = options.volume ?? 1.0;

  utterance.onerror = (e) => {
    if (e.error !== 'interrupted') {
      console.warn('[AARYA/TTS] Speech error:', e.error);
    }
  };

  // Chrome bug workaround: speechSynthesis pauses after ~15s on long texts
  // Split into sentences and queue them
  window.speechSynthesis.speak(utterance);
}

/**
 * Stop any currently playing speech.
 */
export function stopSpeaking() {
  if (typeof window !== 'undefined' && window.speechSynthesis) {
    window.speechSynthesis.cancel();
  }
}

/**
 * Toggle TTS on or off globally.
 * @param {boolean} enabled
 */
export function setVoiceEnabled(enabled) {
  voiceEnabled = Boolean(enabled);
  if (!enabled) stopSpeaking();
  console.log(`[AARYA/TTS] Voice ${enabled ? 'ENABLED' : 'DISABLED'}`);
}

/**
 * Returns current voice enabled state.
 * @returns {boolean}
 */
export function isVoiceEnabled() {
  return voiceEnabled;
}
