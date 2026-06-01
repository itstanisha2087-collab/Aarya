const AARYA_API_BASE = "http://127.0.0.1:8000";

/**
 * Send a message to AARYA and get a dual-response (detailed text + voice summary).
 * @param {string} message - The user's message text
 * @returns {Promise<{detailedText: string, voiceSummary: string, mood: string}>}
 */
export async function sendMessageToAarya(message, language = 'hinglish', voiceType = 'female', voiceSpeed = 'fast') {
  try {
    const res = await fetch(`${AARYA_API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, language, voice_type: voiceType, voice_speed: voiceSpeed }),
    });

    if (!res.ok) {
      throw new Error(`AARYA responded with status ${res.status}`);
    }

    const data = await res.json();

    // ── Phase 5+6: Extract dual-response with full fallback protection ──
    const reply = data?.reply;

    const detailedText =
      reply?.detailed_text ||
      data?.aarya ||           // legacy fallback
      "Response unavailable.";

    const voiceSummary =
      reply?.voice_summary ||
      "Ayush, response screen par available hai.";

    return {
      detailedText: String(detailedText).trim(),
      voiceSummary: String(voiceSummary).trim(),
      audioBytes: reply?.audio_bytes || "",
      mood: data?.mood || "neutral",
    };
  } catch (error) {
    console.error("[AARYA API Error]:", error.message);
    throw new Error("AARYA is unreachable. Backend may be offline.");
  }
}

/**
 * Send a recorded audio Blob to AARYA's Groq Whisper transcription endpoint.
 * @param {Blob} audioBlob - The recorded audio blob (webm, wav, mp3, m4a)
 * @param {string} [filename='recording.webm'] - Filename hint for the server
 * @param {string} [language='hinglish'] - Dynamic language code selection hint
 * @returns {Promise<string>} The transcribed text
 */
export async function transcribeAudio(audioBlob, filename = 'recording.webm', language = 'hinglish') {
  console.log('[AARYA/Transcribe] Client-side manual transcription fetch is deprecated. Wake-word desktop listener is active.');
  return "";
}

/**
 * Fetch conversation history from AARYA backend.
 * @param {number} limit - Number of conversations to fetch (default: 20)
 * @returns {Promise<Array>} Array of past conversations
 */
export async function fetchChatHistory(limit = 20) {
  try {
    const response = await fetch(
      `${AARYA_API_BASE}/history?limit=${limit}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      }
    );

    if (!response.ok) {
      throw new Error(`History fetch failed with status ${response.status}`);
    }

    const data = await response.json();
    return data.conversations || [];
  } catch (error) {
    console.error("[AARYA History Error]:", error.message);
    return [];
  }
}

/**
 * Send a simple heartbeat POST to register active frontend presence.
 */
export async function sendHeartbeat() {
  try {
    await fetch(`${AARYA_API_BASE}/heartbeat`, { method: 'POST' });
  } catch (_) {}
}

/**
 * Fetch consumer status of wake triggers from backend.
 * @returns {Promise<boolean>} True if a remote wake trigger occurred.
 */
export async function checkWakeStatus() {
  try {
    const res = await fetch(`${AARYA_API_BASE}/wake-status`);
    if (res.ok) {
      const data = await res.json();
      return !!data.triggered;
    }
  } catch (_) {}
  return false;
}

/**
 * Triggers AARYA's Vision Mode, capturing the screen and analyzing it contextually.
 * @param {string} [prompt] - Custom analysis instructions (optional)
 * @returns {Promise<{detailedText: string, voiceSummary: string, mood: string}>}
 */
export async function scanMyScreen(prompt = '', language = 'english', voiceType = 'female', voiceSpeed = 'fast') {
  try {
    const res = await fetch(`${AARYA_API_BASE}/api/vision`, {
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
    const reply = data?.reply || data; // handle both direct and nested replies

    const detailedText = reply?.detailed_text || "Vision analysis failed to return detailed results.";
    const voiceSummary = reply?.voice_summary || "Ayush, vision scan completed. Summary is ready on screen.";

    return {
      detailedText: String(detailedText).trim(),
      voiceSummary: String(voiceSummary).trim(),
      audioBytes: reply?.audio_bytes || "",
      mood: data?.mood || "neutral",
    };
  } catch (error) {
    console.error("[AARYA Vision API Error]:", error.message);
    throw new Error("AARYA Vision Mode is unreachable. Backend may be offline.");
  }
}


