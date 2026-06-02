// src/lib/api.js  —  AARYA API + Stream Consumer  (v2.4.1)
// Handles wake, query streaming, state polling, and text rendering.
// Replace this file entirely.

import { voicePlayer } from "./voice.js";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

// How long to wait before retrying a 503 CONFIRM-state rejection (ms)
const CONFIRM_RETRY_DELAY_MS  = 2200;
// Maximum retries on 503 before giving up
const CONFIRM_MAX_RETRIES     = 3;


// ── Wake / State-1 ──────────────────────────────────────────────────────────

/**
 * wakeAarya
 * Calls /api/wake, plays confirmation audio (or displays text fallback),
 * then notifies backend that confirmation is complete.
 *
 * @param {function(string): void} onTextFallback
 *   Called with greeting text when no audio is available.
 * @returns {Promise<void>}
 */
export async function wakeAarya(onTextFallback) {
    let response;
    try {
        response = await fetch(`${BACKEND}/api/wake`, { method: "POST" });
    } catch (err) {
        console.error("[AARYA API] /api/wake network error:", err);
        // Even if wake fails, don't leave the UI in a dead state
        await _notifyConfirmPlayed();
        return;
    }

    if (!response.ok) {
        console.warn("[AARYA API] /api/wake returned", response.status);
        await _notifyConfirmPlayed();
        return;
    }

    let payload;
    try {
        payload = await response.json();
    } catch (err) {
        console.error("[AARYA API] /api/wake JSON parse error:", err);
        await _notifyConfirmPlayed();
        return;
    }

    // Already active — nothing to do
    if (payload.status === "already_active") return;

    // Play audio or show text fallback
    if (payload.response_type === "audio" && payload.audio) {
        try {
            await voicePlayer.playWav(payload.audio);
        } catch (err) {
            console.warn("[AARYA API] WAV playback failed, using text fallback:", err);
            if (typeof onTextFallback === "function") {
                onTextFallback(payload.text ?? "Yes sir, I am listening.");
            }
        }
    } else {
        // Text-only fallback (no audio asset on server)
        if (typeof onTextFallback === "function") {
            onTextFallback(payload.text ?? "Yes sir, I am listening.");
        }
        // Brief display pause before transitioning
        await _sleep(700);
    }

    // Notify backend: State-1 complete, transition to ACTIVE
    await _notifyConfirmPlayed();
}


async function _notifyConfirmPlayed() {
    try {
        await fetch(`${BACKEND}/api/confirm_played`, { method: "POST" });
    } catch (err) {
        console.warn("[AARYA API] /api/confirm_played failed (watchdog will recover):", err);
        // Non-fatal: the 2-second watchdog in the FSM will force ACTIVE
    }
}


// ── Query + NDJSON Stream ───────────────────────────────────────────────────

/**
 * sendQuery
 * Sends a text query and streams the NDJSON response.
 * Handles 503 CONFIRM retries, 403 errors, and stream parsing.
 *
 * @param {string}   text            User's query text.
 * @param {object}   callbacks
 * @param {function(string): void}   callbacks.onTextChunk   Called for each text fragment.
 * @param {function(): void}         callbacks.onDone        Called when stream completes.
 * @param {function(string): void}   callbacks.onError       Called on error frames or HTTP errors.
 * @param {AbortSignal|null}         signal                  Optional AbortSignal for cancellation.
 * @returns {Promise<void>}
 */
export async function sendQuery(text, callbacks = {}, signal = null) {
    const { onTextChunk, onDone, onError } = callbacks;

    // Reset audio player for new utterance
    voicePlayer.reset();

    let attempt = 0;

    while (attempt <= CONFIRM_MAX_RETRIES) {
        let response;

        try {
            response = await fetch(`${BACKEND}/api/query`, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({ text }),
                signal,
            });
        } catch (err) {
            if (err.name === "AbortError") return;
            const msg = `Network error: ${err.message}`;
            console.error("[AARYA API] sendQuery fetch failed:", err);
            if (typeof onError === "function") onError(msg);
            return;
        }

        // 503 = CONFIRM state (FSM not yet ACTIVE) — retry after delay
        if (response.status === 503) {
            attempt++;
            const retryAfter = parseInt(response.headers.get("Retry-After") ?? "2", 10);
            console.warn(
                `[AARYA API] 503 CONFIRM state — retry ${attempt}/${CONFIRM_MAX_RETRIES} ` +
                `in ${retryAfter}s`
            );
            if (attempt > CONFIRM_MAX_RETRIES) {
                if (typeof onError === "function") {
                    onError("AARYA is still initialising. Please try again.");
                }
                return;
            }
            await _sleep(Math.max(retryAfter * 1000, CONFIRM_RETRY_DELAY_MS));
            continue;
        }

        // 403 = DORMANT — tell user to wake AARYA first
        if (response.status === 403) {
            const body = await response.json().catch(() => ({}));
            if (typeof onError === "function") {
                onError(body.detail ?? "AARYA is sleeping. Say 'Hello Aarya' first.");
            }
            return;
        }

        // Any other non-2xx error
        if (!response.ok) {
            if (typeof onError === "function") {
                onError(`Server error: ${response.status} ${response.statusText}`);
            }
            return;
        }

        // ── Stream the NDJSON response ──────────────────────────────────────
        await _consumeNDJSONStream(response, { onTextChunk, onDone, onError });
        return;
    }
}


/**
 * _consumeNDJSONStream
 * Reads an NDJSON response body line-by-line without accumulating the full payload.
 * Handles text and audio frames independently — text renders instantly,
 * audio decodes and enqueues without blocking the text path.
 */
async function _consumeNDJSONStream(response, { onTextChunk, onDone, onError }) {
    const reader  = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let   buffer  = "";

    try {
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            // Accumulate decoded bytes and split on newlines
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");

            // Last element may be a partial line — keep it in the buffer
            buffer = lines.pop() ?? "";

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;

                let frame;
                try {
                    frame = JSON.parse(trimmed);
                } catch {
                    console.error("[AARYA Stream] Malformed frame, skipping:", trimmed.slice(0, 80));
                    continue;
                }

                switch (frame.type) {
                    // ── TEXT: render immediately, do not wait for audio ──────
                    case "text":
                        if (frame.data && typeof onTextChunk === "function") {
                            onTextChunk(frame.data);
                        }
                        break;

                    // ── AUDIO: decode and enqueue; never blocks text path ────
                    case "audio":
                        if (frame.data) {
                            // receiveChunk is async but we intentionally do NOT
                            // await it here — audio processing must not block
                            // the text rendering loop.
                            voicePlayer.receiveChunk(frame.data).catch((err) => {
                                console.error("[AARYA Stream] Audio chunk error:", err);
                            });
                        }
                        break;

                    // ── DONE: finalize audio, signal completion ──────────────
                    case "done":
                        voicePlayer.onStreamComplete();
                        if (typeof onDone === "function") onDone();
                        return;

                    // ── ERROR: surface to caller ─────────────────────────────
                    case "error":
                        if (typeof onError === "function") {
                            onError(frame.data ?? "Unknown stream error");
                        }
                        return;

                    default:
                        // Unknown frame type — log and skip
                        console.warn("[AARYA Stream] Unknown frame type:", frame.type);
                }
            }
        }

        // Body ended without a 'done' frame — treat as complete
        voicePlayer.onStreamComplete();
        if (typeof onDone === "function") onDone();

    } catch (err) {
        if (err.name !== "AbortError") {
            console.error("[AARYA Stream] Reader error:", err);
            if (typeof onError === "function") onError(err.message);
        }
    } finally {
        reader.releaseLock();
    }
}


// ── Utilities ───────────────────────────────────────────────────────────────

function _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


/**
 * dismissAarya
 * Signals backend to return to DORMANT state.
 */
export async function dismissAarya() {
    try {
        await fetch(`${BACKEND}/api/dismiss`, { method: "POST" });
    } catch (err) {
        console.warn("[AARYA API] /api/dismiss failed:", err);
    }
}


/**
 * getAaryaState
 * Returns the current FSM state string from the backend.
 * Useful for UI state indicators.
 * @returns {Promise<string>}  "DORMANT" | "CONFIRM" | "ACTIVE"
 */
export async function getAaryaState() {
    try {
        const r = await fetch(`${BACKEND}/api/state`);
        const d = await r.json();
        return d.state ?? "DORMANT";
    } catch {
        return "DORMANT";
    }
}

// ── Legacy Compatibility Layer ───────────────────────────────────────────

export async function sendMessageToAarya(message, language = 'hinglish', voiceType = 'female', voiceSpeed = 'fast') {
    const res = await fetch(`${BACKEND}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, language, voice_type: voiceType, voice_speed: voiceSpeed }),
    });

    if (!res.ok) {
        throw new Error(`AARYA responded with status ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    let detailedText = "";
    let audioBytes = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const parsed = JSON.parse(line);
                    if (parsed.type === "text") {
                        detailedText += parsed.data;
                    } else if (parsed.type === "audio") {
                        audioBytes += parsed.data;
                    } else if (parsed.type === "error") {
                        throw new Error(parsed.data);
                    }
                } catch (e) {
                    console.warn("Failed to parse NDJSON frame:", line, e);
                }
            }
        }
    }

    return {
        detailedText: detailedText.trim() || "Response unavailable.",
        voiceSummary: detailedText.slice(0, 200),
        audioBytes: audioBytes,
        mood: "neutral",
    };
}

export async function sendMessageToAaryaStreaming(message, onChunk, language = 'hinglish', voiceType = 'female', voiceSpeed = 'fast') {
    const res = await fetch(`${BACKEND}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, language, voice_type: voiceType, voice_speed: voiceSpeed }),
    });

    if (!res.ok) {
        throw new Error(`AARYA responded with status ${res.status}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
            if (line.trim()) {
                try {
                    const parsed = JSON.parse(line);
                    onChunk(parsed);
                } catch (e) {
                    console.warn("Failed to parse NDJSON frame:", line, e);
                }
            }
        }
    }
}

export async function transcribeAudio(audioBlob, filename = 'recording.webm', language = 'hinglish') {
    console.log('[AARYA/Transcribe] Client-side manual transcription fetch is deprecated.');
    return "";
}

export async function sendHeartbeat() {
    try {
        await fetch(`${BACKEND}/heartbeat`, { method: 'POST' });
    } catch (_) {}
}

export async function checkWakeStatus() {
    try {
        const res = await fetch(`${BACKEND}/wake-status`);
        if (res.ok) {
            const data = await res.json();
            return !!data.triggered;
        }
    } catch (_) {}
    return false;
}

export async function scanMyScreen(prompt = '', language = 'english', voiceType = 'female', voiceSpeed = 'fast') {
    const res = await fetch(`${BACKEND}/api/vision`, {
        method: "POST",
        headers: { 
            "Content-Type": "application/json",
            "Cache-Control": "no-cache"
        },
        body: JSON.stringify({ prompt, language, voice_type: voiceType, voice_speed: voiceSpeed, timestamp: Date.now() }),
    });

    if (!res.ok) {
        throw new Error(`AARYA Vision Mode failed with status ${res.status}`);
    }

    const data = await res.json();
    const reply = data?.reply || data;

    const detailedText = reply?.detailed_text || "Vision analysis failed to return detailed results.";
    const voiceSummary = reply?.voice_summary || "Ayush, vision scan completed. Summary is ready on screen.";

    return {
        detailedText: String(detailedText).trim(),
        voiceSummary: String(voiceSummary).trim(),
        audioBytes: reply?.audio_bytes || "",
        mood: data?.mood || "neutral",
    };
}

export async function fetchChatHistory(limit = 20) {
    try {
        const response = await fetch(`${BACKEND}/history?limit=${limit}`);
        if (!response.ok) throw new Error(`History fetch failed`);
        const data = await response.json();
        return data.conversations || [];
    } catch (error) {
        console.error("[AARYA History Error]:", error.message);
        return [];
    }
}

export async function fetchAaryaResponse(mood) {
    try {
        const response = await fetch(`${BACKEND}/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message: `I am feeling ${mood}`, language: "english", voice_type: "female", voice_speed: "fast" }),
        });
        if (!response.ok) throw new Error(`Failed to check mood`);
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";
        let text = "";

        while (true) {
            const { value, done } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop();

            for (const line of lines) {
                if (line.trim()) {
                    const parsed = JSON.parse(line);
                    if (parsed.type === "text") {
                        text += parsed.data;
                    }
                }
            }
        }
        return text.trim();
    } catch (err) {
        throw new Error("Aarya brain is offline.");
    }
}
