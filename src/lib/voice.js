// src/lib/voice.js  —  AARYA Audio Stream Manager  (v2.4.1)
// Handles chunk-by-chunk PCM audio playback from NDJSON stream.
// MIN_BUFFER_CHUNKS = 2: playback begins after 2 audio chunks are queued,
// preventing single-chunk underrun glitches on slow connections.
// Replace this file entirely.

const SAMPLE_RATE       = 24000;   // Must match Gemini multimodal audio output
const MIN_BUFFER_CHUNKS = 2;       // Queue this many chunks before starting playback
const RESET_GRACE_MS    = 300;     // Extra ms after last buffer before reset

/**
 * AaryaVoicePlayer
 *
 * Usage:
 *   const player = new AaryaVoicePlayer();
 *   player.receiveChunk(base64String);   // call for each 'audio' frame
 *   player.onStreamComplete();           // call when 'done' frame arrives
 *   player.reset();                      // call before each new query
 */
export class AaryaVoicePlayer {
    constructor() {
        this._ctx            = null;   // AudioContext — created lazily
        this._queue          = [];     // Pending AudioBuffer objects
        this._nextStartTime  = 0;      // Web Audio scheduled playback cursor
        this._playing        = false;
        this._chunksReceived = 0;
        this._drainPending   = false;
        this._resetTimer     = null;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /**
     * receiveChunk
     * Call once per 'audio' frame in the NDJSON stream.
     * @param {string} base64Data  Base64-encoded Int16 PCM bytes from Gemini.
     */
    async receiveChunk(base64Data) {
        if (!base64Data || typeof base64Data !== "string") return;

        const ctx = this._getContext();

        try {
            // 1. Decode base64 → Uint8Array
            const binary = atob(base64Data);
            const bytes  = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                bytes[i] = binary.charCodeAt(i);
            }

            // 2. Reinterpret as Int16, normalise to Float32 [-1.0, 1.0]
            const int16   = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) {
                float32[i] = int16[i] / 32768.0;
            }

            // 3. Wrap in AudioBuffer
            const audioBuffer = ctx.createBuffer(
                1,               // channels: mono
                float32.length,  // frame count
                SAMPLE_RATE,
            );
            audioBuffer.copyToChannel(float32, 0);

            // 4. Enqueue
            this._queue.push(audioBuffer);
            this._chunksReceived++;

            // 5. Begin playback once minimum buffer is met
            if (!this._playing && this._chunksReceived >= MIN_BUFFER_CHUNKS) {
                this._playing       = true;
                // Tiny lead-in gap prevents click at stream start
                this._nextStartTime = ctx.currentTime + 0.04;
                this._scheduleDrain();
            }

        } catch (err) {
            console.error("[AARYA Voice] receiveChunk error:", err);
        }
    }

    /**
     * onStreamComplete
     * Call when the NDJSON stream emits a 'done' frame.
     * Schedules a reset after remaining audio finishes playing.
     */
    onStreamComplete() {
        const ctx       = this._getContext();
        const remaining = Math.max(0, this._nextStartTime - ctx.currentTime);

        clearTimeout(this._resetTimer);
        this._resetTimer = setTimeout(() => {
            this.reset();
        }, (remaining * 1000) + RESET_GRACE_MS);
    }

    /**
     * reset
     * Call before each new query to clear state without closing AudioContext.
     * Closing and re-creating AudioContext causes click artefacts in Chrome.
     */
    reset() {
        clearTimeout(this._resetTimer);
        this._queue          = [];
        this._playing        = false;
        this._nextStartTime  = 0;
        this._chunksReceived = 0;
        this._drainPending   = false;
        this._resetTimer     = null;
    }

    /**
     * playWav
     * Plays a WAV blob (used for State-1 confirmation audio).
     * Returns a Promise that resolves when playback finishes.
     * @param {string} base64Wav   Base64-encoded WAV file bytes.
     * @returns {Promise<void>}
     */
    async playWav(base64Wav) {
        const ctx = this._getContext();

        const binary  = atob(base64Wav);
        const bytes   = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        // decodeAudioData handles the WAV container (header + PCM)
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer);

        return new Promise((resolve) => {
            const source     = ctx.createBufferSource();
            source.buffer    = audioBuffer;
            source.connect(ctx.destination);
            source.onended   = () => resolve();
            source.start(0);
        });
    }

    // ── Private ─────────────────────────────────────────────────────────────

    _getContext() {
        if (!this._ctx || this._ctx.state === "closed") {
            this._ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        }
        if (this._ctx.state === "suspended") {
            // Required by browser autoplay policy — resume on user gesture
            this._ctx.resume().catch(() => {});
        }
        return this._ctx;
    }

    _scheduleDrain() {
        if (this._drainPending) return;
        this._drainPending = true;
        requestAnimationFrame(() => {
            this._drainPending = false;
            this._drain();
        });
    }

    _drain() {
        if (!this._playing) return;

        const ctx = this._getContext();

        // Drain everything currently in the queue
        while (this._queue.length > 0) {
            const buf    = this._queue.shift();
            const source = ctx.createBufferSource();
            source.buffer = buf;
            source.connect(ctx.destination);

            // Schedule to play exactly after the previous buffer ends.
            // Math.max guards against the cursor lagging behind currentTime
            // on slow devices.
            const startAt       = Math.max(this._nextStartTime, ctx.currentTime);
            source.start(startAt);
            this._nextStartTime = startAt + buf.duration;
        }

        // Keep draining — more chunks may still be arriving
        this._scheduleDrain();
    }
}

// Module-level singleton — import this in api.js
export const voicePlayer = new AaryaVoicePlayer();

// ── Legacy Compatibility Layer ───────────────────────────────────────────
let voiceEnabled = true;
let stateChangeCallback = null;

export function onPlaybackStateChange(callback) {
    stateChangeCallback = callback;
}

export function setVoiceEnabled(enabled) {
    voiceEnabled = Boolean(enabled);
}

export function isVoiceEnabled() {
    return voiceEnabled;
}

export function stopSpeaking() {
    voicePlayer.reset();
    if (stateChangeCallback) stateChangeCallback(false);
}

export function speakText(text, audioBytes = null) {
    if (!voiceEnabled) return;
    if (audioBytes) {
        voicePlayer.playWav(audioBytes).catch(() => {});
    }
}

export function startAudioStream() {
    voicePlayer.reset();
    if (stateChangeCallback) stateChangeCallback(true);
}

export function receiveAudioStreamChunk(base64PCM) {
    voicePlayer.receiveChunk(base64PCM).catch(() => {});
}

export function endAudioStream() {
    voicePlayer.onStreamComplete();
}
