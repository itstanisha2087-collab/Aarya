/**
 * AARYA Premium Voice Utility — High-Fidelity Neural TTS Playback
 * Streams Microsoft Neural Indian Voices dynamically from the FastAPI backend.
 * Uses a sentence-by-sentence queue streaming architecture (Gemini Live-style)
 * to deliver ultra-low initial latency (sub-200ms) with seamless pacing.
 * 
 * Also implements a Web Audio API progressive stream player to decode and play
 * base64-encoded Int16 PCM chunks dynamically with zero gaps.
 * 
 * Usage:
 *   import { speakText, stopSpeaking, setVoiceEnabled, onPlaybackStateChange, startAudioStream, receiveAudioStreamChunk, endAudioStream } from '@/lib/voice';
 */

const AARYA_API_BASE = "http://127.0.0.1:8000";
let voiceEnabled = true;
let stateChangeCallback = null;

// Playlist Queue State Variables (Legacy / Fallback)
let sentenceQueue = [];
let currentSentenceIndex = 0;
let currentAudioNode = null;
let isSpeakingState = false;

// Progressive Streaming State Variables
let audioCtx = null;
let nextPlayTime = 0;
let isStreamingActive = false;
let audioSourcesQueue = [];
let isDecoding = false;
let chunkQueue = [];

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
  
  // Stop and clear any active Web Audio stream player
  isStreamingActive = false;
  for (const source of audioSourcesQueue) {
    try {
      source.stop();
    } catch (_) {}
  }
  audioSourcesQueue = [];
  chunkQueue = [];
  isDecoding = false;
  
  if (audioCtx) {
    try {
      audioCtx.close();
    } catch (_) {}
    audioCtx = null;
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
 * Helper to convert base64 String (Int16 raw PCM 24kHz) to Float32Array.
 */
function base64ToFloat32(base64Str) {
  const binaryString = atob(base64Str);
  const len = binaryString.length;
  const buffer = new ArrayBuffer(len);
  const view = new DataView(buffer);
  for (let i = 0; i < len; i++) {
    view.setUint8(i, binaryString.charCodeAt(i));
  }
  
  const numSamples = len / 2;
  const float32Array = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    const int16 = view.getInt16(i * 2, true); // true for little endian
    float32Array[i] = int16 / 32768.0;
  }
  return float32Array;
}

/**
 * Starts a progressive Web Audio stream player.
 */
export function startAudioStream() {
  if (typeof window === 'undefined') return;
  if (!voiceEnabled) return;
  
  stopSpeaking(); // stop any current speech
  
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  
  // Align AudioContext strictly to Gemini's 24kHz native sampling rate
  audioCtx = new AudioContextClass({ sampleRate: 24000 });
  nextPlayTime = audioCtx.currentTime;
  isStreamingActive = true;
  audioSourcesQueue = [];
  
  isSpeakingState = true;
  if (stateChangeCallback) {
    stateChangeCallback(true);
  }
  console.log("[voice.js] Web Audio progressive stream player started at 24kHz.");
}

/**
 * Feeds a base64-encoded raw Int16 PCM chunk into the Web Audio scheduler.
 */
export function receiveAudioStreamChunk(base64PCM) {
  if (!isStreamingActive || !audioCtx) return;
  chunkQueue.push(base64PCM);
  processChunkQueue();
}

async function processChunkQueue() {
  if (isDecoding) return;
  
  // 2-Chunk Playback Pre-Buffering Gate:
  // If no audio is currently playing (audioSourcesQueue.length === 0) and the stream is still active (isStreamingActive === true),
  // do not decode or play until chunkQueue.length >= 2.
  if (audioSourcesQueue.length === 0 && isStreamingActive && chunkQueue.length < 2) {
    console.log(`[voice.js] Pre-buffering: holding stream playback (chunks: ${chunkQueue.length}/2)...`);
    return;
  }
  
  if (chunkQueue.length === 0) return;
  
  isDecoding = true;
  const base64PCM = chunkQueue.shift();
  try {
    const binaryString = atob(base64PCM);
    const len = binaryString.length;
    const arrayBuffer = new ArrayBuffer(len);
    const uint8Array = new Uint8Array(arrayBuffer);
    for (let i = 0; i < len; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }
    
    let buffer = null;
    
    // Detect format
    const isWav = len > 4 && uint8Array[0] === 0x52 && uint8Array[1] === 0x49 && uint8Array[2] === 0x46 && uint8Array[3] === 0x46; // 'RIFF'
    const isMp3 = len > 3 && (
      (uint8Array[0] === 0x49 && uint8Array[1] === 0x44 && uint8Array[2] === 0x33) || // 'ID3'
      (uint8Array[0] === 0xFF && (uint8Array[1] & 0xE0) === 0xE0) // sync frame
    );
    
    if (isWav || isMp3) {
      try {
        buffer = await audioCtx.decodeAudioData(arrayBuffer);
      } catch (err) {
        console.warn("[voice.js] Native decoding failed:", err);
      }
    }
    
    if (!buffer) {
      // Fallback to raw Int16 PCM (24kHz Mono)
      const numSamples = len / 2;
      const float32Data = new Float32Array(numSamples);
      const dataView = new DataView(arrayBuffer);
      for (let i = 0; i < numSamples; i++) {
        const int16 = dataView.getInt16(i * 2, true);
        float32Data[i] = int16 / 32768.0;
      }
      buffer = audioCtx.createBuffer(1, float32Data.length, 24000);
      buffer.copyToChannel(float32Data, 0);
    }
    
    if (buffer && buffer.length > 0) {
      // Expose fallback audio logging exactly as requested
      console.log('[Frontend Audio]: Playing chunk queue...', buffer.length);
      
      const source = audioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(audioCtx.destination);
      
      const startTime = Math.max(nextPlayTime, audioCtx.currentTime);
      source.start(startTime);
      
      const duration = buffer.duration;
      nextPlayTime = startTime + duration;
      
      audioSourcesQueue.push(source);
      
      source.onended = () => {
        const idx = audioSourcesQueue.indexOf(source);
        if (idx !== -1) {
          audioSourcesQueue.splice(idx, 1);
        }
        
        if (audioSourcesQueue.length === 0 && !isStreamingActive && chunkQueue.length === 0) {
          isSpeakingState = false;
          if (stateChangeCallback) stateChangeCallback(false);
        }
      };
    }
  } catch (err) {
    console.error("[voice.js] Error processing audio chunk:", err);
  } finally {
    isDecoding = false;
    processChunkQueue();
  }
}

/**
 * Signals that the progressive stream is finished.
 */
export function endAudioStream() {
  console.log("[voice.js] Web Audio progressive stream ended.");
  isStreamingActive = false;
  // Trigger final flush
  processChunkQueue();
  // If no source is playing, we can complete speaking state immediately
  if (audioSourcesQueue.length === 0) {
    isSpeakingState = false;
    if (stateChangeCallback) stateChangeCallback(false);
  }
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
