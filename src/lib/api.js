const AARYA_API_BASE = "http://127.0.0.1:8000";

/**
 * Send a message to AARYA and get a personality-driven response.
 * @param {string} message - The user's message text
 * @returns {Promise<{aarya: string, mood: string}>} The response and detected mood
 */
export async function sendMessageToAarya(message) {
  try {
    const response = await fetch(`${AARYA_API_BASE}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      throw new Error(`AARYA responded with status ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error("[AARYA API Error]:", error.message);
    throw new Error("AARYA is unreachable. Backend may be offline.");
  }
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
