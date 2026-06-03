'use strict';
class ProhibitedAPIError extends Error {
    constructor(api) {
        super(`[AARYA] PROHIBITED API CALLED: ${api}. Local TTS is permanently disabled.`);
        this.name = 'ProhibitedAPIError';
    }
}
if (typeof window !== 'undefined') {
    try {
        Object.defineProperty(window, 'speechSynthesis', {
            get: () => ({
                speak: () => { throw new ProhibitedAPIError('speechSynthesis.speak'); },
                cancel: () => {}, pause: () => {}, resume: () => {},
            }),
            configurable: false,
        });
    } catch (e) {}
}
const SAMPLE_RATE = 24000;
const MIN_BUFFER_CHUNKS = 2;
const RESET_GRACE_MS = 300;
export class AaryaVoicePlayer {
    constructor() {
        this._ctx = null; this._queue = []; this._nextStartTime = 0;
        this._playing = false; this._chunksReceived = 0; this._drainPending = false; this._resetTimer = null;
    }
    async receiveChunk(base64Data) {
        if (!base64Data || typeof base64Data !== "string") return;
        const ctx = this._getContext();
        try {
            const binary = atob(base64Data);
            const bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
            const int16 = new Int16Array(bytes.buffer);
            const float32 = new Float32Array(int16.length);
            for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;
            const audioBuffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
            audioBuffer.copyToChannel(float32, 0);
            this._queue.push(audioBuffer);
            this._chunksReceived++;
            if (!this._playing && this._chunksReceived >= MIN_BUFFER_CHUNKS) {
                this._playing = true; this._nextStartTime = ctx.currentTime + 0.04;
                this._scheduleDrain();
            }
        } catch (err) { console.error("[AARYA Voice] receiveChunk error:", err); }
    }
    onStreamComplete() {
        const ctx = this._getContext();
        const remaining = Math.max(0, this._nextStartTime - ctx.currentTime);
        clearTimeout(this._resetTimer);
        this._resetTimer = setTimeout(() => { this.reset(); }, (remaining * 1000) + RESET_GRACE_MS);
    }
    reset() {
        clearTimeout(this._resetTimer); this._queue = []; this._playing = false;
        this._nextStartTime = 0; this._chunksReceived = 0; this._drainPending = false; this._resetTimer = null;
    }
    async playWav(base64Wav) {
        const ctx = this._getContext();
        const binary = atob(base64Wav);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
        return new Promise((resolve) => {
            const source = ctx.createBufferSource(); source.buffer = audioBuffer;
            source.connect(ctx.destination); source.onended = () => resolve(); source.start(0);
        });
    }
    _getContext() {
        if (!this._ctx || this._ctx.state === "closed") this._ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
        if (this._ctx.state === "suspended") this._ctx.resume().catch(() => {});
        return this._ctx;
    }
    _scheduleDrain() {
        if (this._drainPending) return; this._drainPending = true;
        requestAnimationFrame(() => { this._drainPending = false; this._drain(); });
    }
    _drain() {
        if (!this._playing) return;
        const ctx = this._getContext();
        while (this._queue.length > 0) {
            const buf = this._queue.shift(); const source = ctx.createBufferSource();
            source.buffer = buf; source.connect(ctx.destination);
            const startAt = Math.max(this._nextStartTime, ctx.currentTime);
            source.start(startAt); this._nextStartTime = startAt + buf.duration;
        }
        this._scheduleDrain();
    }
}
export const voicePlayer = new AaryaVoicePlayer();
let voiceEnabled = true; let stateChangeCallback = null;
export function onPlaybackStateChange(callback) { stateChangeCallback = callback; }
export function setVoiceEnabled(enabled) { voiceEnabled = Boolean(enabled); }
export function isVoiceEnabled() { return voiceEnabled; }
export function stopSpeaking() { voicePlayer.reset(); if (stateChangeCallback) stateChangeCallback(false); }
export function speakText(text, audioBytes = null) { if (!voiceEnabled) return; if (audioBytes) voicePlayer.playWav(audioBytes).catch(() => {}); }
export function startAudioStream() { voicePlayer.reset(); if (stateChangeCallback) stateChangeCallback(true); }
export function receiveAudioStreamChunk(base64PCM) { voicePlayer.receiveChunk(base64PCM).catch(() => {}); }
export function endAudioStream() { voicePlayer.onStreamComplete(); }
export class GeminiAudioPlayer {
    constructor() { this._player = voicePlayer; }
    enqueueChunk(b64) { return this._player.receiveChunk(b64); }
    stop() { this._player.stop ? this._player.stop() : this._player.reset(); }
}
export class AARYAVoiceClient {
    constructor({ onText, onError, onWarning, onDone } = {}) {
        this._player = new GeminiAudioPlayer(); this._onText = onText || (() => {});
        this._onError = onError || (() => {}); this._onWarning = onWarning || (() => {}); this._onDone = onDone || (() => {});
    }
    async query(prompt, options = {}) {}
}
export { ProhibitedAPIError }; export default AARYAVoiceClient;
