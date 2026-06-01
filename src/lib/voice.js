/**
 * AARYA Premium Voice Utility — High-Fidelity Neural TTS Playback
 * Streams Microsoft Neural Indian Voices dynamically from the FastAPI backend.
 * Uses a sentence-by-sentence queue streaming architecture (Gemini Live-style)
 * to deliver ultra-low initial latency (sub-200ms) with seamless pacing.
 * 
 * Usage:
 *   import { speakText, stopSpeaking, setVoiceEnabled, onPlaybackStateChange } from '@/lib/voice';
 */

const AARYA_API_BASE = "http://127.0.0.1:8000";
let voiceEnabled = true;
let stateChangeCallback = null;

// Playlist Queue State Variables
let sentenceQueue = [];
let currentSentenceIndex = 0;
let currentAudioNode = null;
let isSpeakingState = false;

/**
 * Register a listener to be notified when speech playback starts or stops.
 * Used by ChatInterface to sync the glowing voice orb speak animations.
 * @param {function} callback - Receives (isPlaying: boolean)
 */
export function onPlaybackStateChange(callback) {
  stateChangeCallback = callback;
}

/**
 * Splits text into conversational sentences.
 * Handles English (.!?), Hindi (।), and mixed technical structures cleanly.
 */
function splitIntoSentences(text) {
  if (!text) return [];
  // Split by ending punctuation while preserving it
  const rawChunks = text.match(/[^.!?।\n]+[.!?।\n]*/g) || [text];
  return rawChunks
    .map(c => c.trim())
    .filter(c => c.length > 2); // ignore tiny fragments
}

// Register IPC listener for Electron native audio playback completion
if (typeof window !== 'undefined' && window.ipcRenderer) {
  window.ipcRenderer.on('audio-playback-completed', () => {
    console.log('[AARYA/TTS] Native playback completed event received');
    isSpeakingState = false;
    if (stateChangeCallback) {
      stateChangeCallback(false);
    }
  });
}

/**
 * Instantly stops and garbage collects all playing and pre-buffered audio tracks.
 */
export function stopSpeaking() {
  if (typeof window === 'undefined') return;
  
  // Enforce SAIL stop in Electron
  if (window.ipcRenderer) {
    try {
      window.ipcRenderer.send('stop-audio');
    } catch (_) {}
  }

  if (currentAudioNode) {
    try {
      currentAudioNode.pause();
      currentAudioNode.src = ""; // instantly terminate active network socket
    } catch (_) {}
    currentAudioNode = null;
  }
  
  sentenceQueue = [];
  currentSentenceIndex = 0;
  
  if (isSpeakingState) {
    isSpeakingState = false;
    if (stateChangeCallback) {
      stateChangeCallback(false);
    }
  }
}

/**
 * Plays the current sentence in the queue, and preloads the next sentence.
 */
function playQueue(language, voiceType, voiceSpeed = 'fast') {
  if (currentSentenceIndex >= sentenceQueue.length) {
    // Playlist finished cleanly!
    isSpeakingState = false;
    if (stateChangeCallback) stateChangeCallback(false);
    return;
  }

  const currentText = sentenceQueue[currentSentenceIndex];
  
  // Construct TTS URL for the current sentence chunk
  const ttsUrl = `${AARYA_API_BASE}/api/tts?text=${encodeURIComponent(currentText)}&language=${encodeURIComponent(language)}&voice_type=${encodeURIComponent(voiceType)}&voice_speed=${encodeURIComponent(voiceSpeed)}`;
  
  console.log(`[AARYA/TTS] Playing sentence [${currentSentenceIndex + 1}/${sentenceQueue.length}]: "${currentText.slice(0, 30)}..."`);
  
  try {
    currentAudioNode = new Audio(ttsUrl);
    
    // As soon as this chunk finishes, play the next one seamlessly
    currentAudioNode.onended = () => {
      currentSentenceIndex++;
      playQueue(language, voiceType, voiceSpeed);
    };

    currentAudioNode.onerror = (err) => {
      console.warn(`[AARYA/TTS] Error on sentence index ${currentSentenceIndex}:`, err);
      // Skip failed chunk and continue playing queue
      currentSentenceIndex++;
      playQueue(language, voiceType, voiceSpeed);
    };

    const playPromise = currentAudioNode.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        if (err.name !== 'AbortError') {
          console.warn('[AARYA/TTS] Playback skipped or aborted:', err.message);
        }
      });
    }

    // ── Ultra-Latency Preloader (Pre-buffers the NEXT sentence in cache) ──
    if (currentSentenceIndex + 1 < sentenceQueue.length) {
      const nextText = sentenceQueue[currentSentenceIndex + 1];
      const nextUrl = `${AARYA_API_BASE}/api/tts?text=${encodeURIComponent(nextText)}&language=${encodeURIComponent(language)}&voice_type=${encodeURIComponent(voiceType)}&voice_speed=${encodeURIComponent(voiceSpeed)}`;
      // Creating the Audio node begins fetching and buffering in browser background cache natively!
      const prefetcher = new Audio();
      prefetcher.preload = "auto";
      prefetcher.src = nextUrl;
    }

  } catch (err) {
    console.error('[AARYA/TTS] Error executing voice queue:', err);
    currentSentenceIndex++;
    playQueue(language, voiceType, voiceSpeed);
  }
}

export function strictlyCleanAudioText(rawLlmText) {
  if (!rawLlmText) return "";
  // 1. Remove entire markdown code blocks completely (including content inside)
  let cleanText = rawLlmText.replace(/```[a-zA-Z]*\n[\s\S]*?```/g, '');
  // 2. Remove inline code snippets (e.g., `code`)
  cleanText = cleanText.replace(/`[^`]+`/g, '');
  // 3. Remove all http/https/www URLs completely
  cleanText = cleanText.replace(/https?:\/\/\S+|www\.\S+/g, '');
  // 4. Strip out all remaining markdown syntax markers (*, #, _, [, ], (, ))
  cleanText = cleanText.replace(/[\*#`_\[\]\(\)]/g, '');
  // 5. Clean up multiple spaces or lingering single slashes
  cleanText = cleanText.replace(/\s+/g, ' ').trim();
  return cleanText;
}

/**
 * Overhauls the speech utility into a zero-latency native audio or sentence pipeline.
 */
export function speakText(text, audioBytes = null, language = 'hinglish', voiceType = 'female', voiceSpeed = 'fast') {
  if (typeof window === 'undefined') return;
  if (!voiceEnabled) return;

  // 1. Instantly halt any playing tracks (both local and Electron SAIL)
  stopSpeaking();

  // 2. Direct native multimodal playback path (PRD v2.0.0)
  if (audioBytes && window.ipcRenderer) {
    console.log('[AARYA/TTS] Playing native Gemini multimodal audio bytes via Electron');
    isSpeakingState = true;
    if (stateChangeCallback) {
      stateChangeCallback(true);
    }
    try {
      window.ipcRenderer.send('play-audio', audioBytes);
      return;
    } catch (err) {
      console.warn('[AARYA/TTS] Electron native audio bridge failed, falling back to network stream:', err);
    }
  }

  if (!text || typeof text !== 'string') return;

  // 3. Fallback sentence-by-sentence queue streaming path
  let cleanText = strictlyCleanAudioText(text);

  // Strip bullet point and list markers
  cleanText = cleanText.replace(/^\s*[-*+]\s/gm, '');
  // Strip separators
  cleanText = cleanText.replace(/---/g, '');
  // Collapse newlines
  cleanText = cleanText.replace(/\n/g, ' ');
  // Clean up excessive spacing
  cleanText = cleanText.replace(/\s+/g, ' ').trim();

  if (!cleanText) return;

  // Segment response into conversational sentence playlist
  sentenceQueue = splitIntoSentences(cleanText);
  if (sentenceQueue.length === 0) return;

  currentSentenceIndex = 0;
  isSpeakingState = true;

  // Notify frontend to animate speaking orb
  if (stateChangeCallback) {
    stateChangeCallback(true);
  }

  // Start streaming queue
  playQueue(language, voiceType, voiceSpeed);
}

/**
 * Toggle TTS on/off globally.
 */
export function setVoiceEnabled(enabled) {
  voiceEnabled = Boolean(enabled);
  if (!enabled) {
    stopSpeaking();
  }
  console.log(`[AARYA/TTS] Mute state toggled. Speech is: ${enabled ? 'ACTIVE' : 'MUTED'}`);
}

/**
 * Checks current voice enabled state.
 */
export function isVoiceEnabled() {
  return voiceEnabled;
}
