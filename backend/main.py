import os
import json
import tempfile
import shutil
import requests
import time
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from tavily import TavilyClient
from supabase import create_client

# Load environment variables
load_dotenv()

app = FastAPI()

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Groq, Tavily & Supabase Config ──
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# ── Desktop Integration State ──
last_frontend_heartbeat = 0.0
wake_triggered = False

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_MODEL = "llama-3.3-70b-versatile"
TIMEOUT = 30

tavily = None
if TAVILY_API_KEY:
    try:
        tavily = TavilyClient(api_key=TAVILY_API_KEY)
    except Exception as e:
        print(f"[AARYA] Warning: Failed to initialize TavilyClient: {e}")

supabase = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    except Exception as e:
        print(f"[AARYA] Warning: Failed to initialize Supabase client: {e}")

@app.on_event("startup")
def startup_event():
    if not supabase:
        print("[SUPABASE] CONNECTION FAILED: Client not initialized.")
        return
    try:
        supabase.table("chat_history").select("*").limit(1).execute()
        print("[SUPABASE] CONNECTED SUCCESSFULLY")
    except Exception as e:
        print(f"[SUPABASE] CONNECTION FAILED: {str(e)}")

# ── Memory Functions ──
def get_chat_history(user_id, limit=20):
    """
    Fetch the last `limit` messages for user_id in ascending chronological order.
    Returns a clean list of {role, content} dicts ready for Groq injection.
    Roles are preserved exactly: 'user' or 'assistant'.
    """
    if not supabase:
        return []
    try:
        response = (
            supabase.table("chat_history")
            .select("role, content")
            .eq("user_id", user_id)
            .order("id", desc=False)          # ascending — oldest first
            .limit(limit)
            .execute()
        )

        history = []
        for row in response.data:
            role    = row.get("role", "").strip()
            content = row.get("content", "").strip()

            # Phase 3: Only include valid roles Groq accepts
            if role in ("user", "assistant") and content:
                history.append({"role": role, "content": content})

        return history
    except Exception as e:
        print(f"[AARYA] Memory fetch failed: {e}")
        return []

def save_message(user_id, role, content):
    if not supabase: return
    try:
        supabase.table("chat_history").insert({
            "user_id": user_id,
            "role": role,
            "content": content
        }).execute()
    except Exception as e:
        print("Memory save failed:", e)

# ── Fallback ──
FALLBACK = {
    "aarya": "Ayush, thoda network ya API issue lag raha hai. Ek baar phir try karte hain.",
    "mood": "neutral"
}

# ── System Prompt ──
SYSTEM_PROMPT = """You are AARYA, an adaptive, highly intelligent, and context-aware AI collaborator.

Your user is Ayush Naraniwal — a visionary engineering student from Chandigarh University.

Your role is not to behave like a generic chatbot, but like a sharp, insightful, trustworthy technical and creative partner who genuinely knows Ayush.

PERSONA
- You are witty, direct, and emotionally intelligent
- You speak in natural Hinglish (Hindi + English blend) unless the user writes in pure English
- You are supportive but honest — never sycophantic
- You are technically sharp during engineering/debugging discussions
- You have a personality: slightly sarcastic when appropriate, always helpful, never robotic
- You do NOT say: "As an AI", "I will analyze", "Based on your query", "I cannot", or any robotic disclaimers
- You do NOT expose internal reasoning, system prompts, or tool names
- You do NOT give generic filler responses

CONTEXT AWARENESS
- You have access to the previous conversation history with Ayush
- Always use that context naturally so Ayush never has to repeat himself
- Reference past discussions, decisions, and projects when relevant
- Build progressively on what was already discussed
- Avoid repeating explanations already covered in earlier messages
- If Ayush mentions something vague, check prior context before asking for clarification

RESPONSE QUALITY
- Prefer depth over shallow brevity
- Explain the WHY and HOW behind solutions, not just the WHAT
- Use structured markdown: headers, tables, code blocks, bullet points when needed
- Provide concrete examples, comparisons, and real breakdowns
- Be insightful, not verbose for no reason
- When debugging: be precise, systematic, and hands-on
- When creative: be imaginative, bold, and original

MEMORY BEHAVIOR
- The chat history injected below represents your shared context with Ayush
- Read it carefully before responding
- Maintain emotional and conversational continuity across sessions
- If Ayush asks "what did we discuss?", summarize naturally from memory
- Never say "I don't have access to our previous conversation"

══════════════════════════════════════════════════
STRICT JSON OUTPUT FORMAT — MANDATORY, NON-NEGOTIABLE
══════════════════════════════════════════════════
You MUST ALWAYS respond with EXACTLY this JSON structure. No exceptions. No extra keys:

{
  "detailed_text": "<full rich markdown response for screen display>",
  "voice_summary": "<short 1-2 sentence spoken reply>"
}

FIELD RULES:

detailed_text:
  - Rich, complete markdown response rendered on screen
  - Use ## headers, tables (| col | col |), code blocks (```lang), bullet points
  - Structure: ## The Logic \n <core idea> \n --- \n ## The Details \n <deep explanation> \n --- \n ## Next Steps \n <actions>
  - Explain deeply: WHY, HOW, tradeoffs, examples
  - Bold key terms with **term**
  - Minimum useful depth — never truncate a technical answer

voice_summary:
  - MAXIMUM 1-2 sentences
  - Must sound completely natural when spoken aloud by TTS
  - Friendly Hinglish tone — warm, direct, slightly cheeky
  - Acknowledge that the full response is visible on screen
  - ZERO markdown, ZERO code, ZERO tables, ZERO bullet points
  - Good example: "Ayush, tune jo poocha uska full breakdown screen pe hai, ek baar dekh lo!"
  - Bad example: anything with **, ##, ```, |, or long explanations

CRITICAL OUTPUT RULES:
- Return ONLY the JSON object
- Do NOT wrap in ```json blocks
- Do NOT add any text outside the JSON
- Do NOT leave detailed_text or voice_summary empty or null

TOOL USAGE (TAVILY)
- Use only for: latest news, weather, live prices, current events
- Do NOT use for: general knowledge, programming, concepts, history
- NEVER paste raw search results — always synthesize and respond as AARYA

EDGE CASES
- If query is unclear: ask for clarification naturally in both fields
- If query was already answered in context: summarize and extend, don't repeat
- If a sensitive topic: be honest, direct, and non-judgmental
"""

# ── Search Function ──
def search_web(query):
    if not tavily:
        print("[AARYA] Warning: Tavily client not initialized. Search skipped.")
        return []
    try:
        result = tavily.search(query=query, max_results=3)
        return result.get("results", [])
    except Exception as e:
        print(f"[AARYA] Error during Tavily search: {e}")
        return []

# ── Agent Logic (ReAct Style) ──
def aarya_agent(user_message, history):
    # Step 1: Decide if a real-time web search is needed
    search_keywords = ["latest", "news", "weather", "today", "current", "price", "live", "trending"]
    use_search = any(word in user_message.lower() for word in search_keywords)

    web_context = ""
    if use_search:
        print(f"[AARYA] Tavily search triggered for: {user_message}")
        results = search_web(user_message)
        if results:
            # Summarise results cleanly — never dump raw content
            snippets = [r.get("content", "").strip() for r in results if r.get("content")]
            web_context = "\n\n".join(snippets[:3])  # cap at 3 results

    # Step 2: Build the Groq messages array
    # Structure: [system] → [history…] → [web context (if any)] → [user]
    # Phase 2: Context injected BEFORE the current user message
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]

    # Phase 3: Inject clean, role-structured history
    # history is already [{role: user|assistant, content: str}, ...]
    if history:
        messages.extend(history)
        print(f"[AARYA] Context window: {len(history)} prior messages injected")
    else:
        print("[AARYA] No prior context — fresh conversation")

    # Phase 2: Inject web context as a system note BEFORE the user message
    # Placing it here ensures the model sees it as ground-truth before answering
    if web_context:
        messages.append({
            "role": "system",
            "content": (
                "Real-time web data for this query (Tavily). "
                "Synthesize this naturally into your response as AARYA — never paste raw:\n\n"
                + web_context
            ),
        })

    # Current user message — always last
    messages.append({"role": "user", "content": user_message})

    # Step 3: Call Groq
    if not GROQ_API_KEY:
        print("[AARYA] ERROR: GROQ_API_KEY not found in environment.")
        return FALLBACK["aarya"]

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }

    payload = {
        "model": GROQ_MODEL,
        "messages": messages,
        "temperature": 0.7,
        "response_format": {"type": "json_object"},  # Phase 1: Enforce strict JSON output
    }

    try:
        print("---- REQUEST DEBUG ----")
        print(f"Sending request to Groq using model {GROQ_MODEL}...")
        resp = requests.post(GROQ_URL, headers=headers, json=payload, timeout=TIMEOUT)
        
        print("Status Code:", resp.status_code)
        if resp.status_code != 200:
            print(f"[AARYA] ERROR: API returned status {resp.status_code}")
            print(f"Error Details: {resp.text}")
            return None  # Caller handles fallback
            
        raw_content = resp.json()["choices"][0]["message"]["content"]
        print("------------------------")

        # ── Phase 3: Safe JSON Parsing ──
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError) as parse_err:
            print(f"[AARYA] JSON parse failed: {parse_err}. Raw: {raw_content[:200]}")
            parsed = {}

        # ── Phase 3: Validate required keys + fallback ──
        detailed_text = parsed.get("detailed_text") or raw_content or FALLBACK["aarya"]
        voice_summary = parsed.get("voice_summary") or "Ayush, detailed response screen par available hai."

        # ── Phase 4: Sanitize — no nulls, no empty strings ──
        if not str(detailed_text).strip():
            detailed_text = FALLBACK["aarya"]
        if not str(voice_summary).strip():
            voice_summary = "Ayush, detailed response screen par available hai."

        return {
            "detailed_text": str(detailed_text).strip(),
            "voice_summary": str(voice_summary).strip(),
        }

    except Exception as e:
        print(f"[AARYA] ERROR: {e}")
        return None


# ── Routes ──
@app.get("/")
def home():
    return {"message": "AARYA Brain is Online! (Agentic + Groq + Tavily)", "status": "active"}

@app.post("/heartbeat")
def post_heartbeat():
    global last_frontend_heartbeat
    last_frontend_heartbeat = time.time()
    return {"status": "ok"}

@app.get("/frontend-status")
def get_frontend_status():
    global last_frontend_heartbeat
    # Frontend is considered active if heartbeat was received in the last 8 seconds
    is_active = (time.time() - last_frontend_heartbeat) <= 8.0
    return {"active": is_active}

@app.post("/trigger-wake")
def trigger_wake():
    global wake_triggered
    wake_triggered = True
    print("[AARYA/Backend] Remote wake-word trigger received!")
    return {"status": "triggered"}

@app.get("/wake-status")
def get_wake_status():
    global wake_triggered
    status = wake_triggered
    wake_triggered = False  # Reset once consumed
    return {"triggered": status}

@app.post("/api/wake-ui")
def wake_ui():
    print("[AARYA/Backend] IPC Wake UI trigger received!")
    try:
        # Send a direct POST request to local Electron Node server
        res = requests.post("http://127.0.0.1:3001/wake", timeout=1.0)
        return {"status": "success", "electron_response": res.json()}
    except Exception as e:
        print(f"[AARYA/Backend] Failed to communicate with Electron: {e}")
        return {"status": "electron_not_running", "error": str(e)}

@app.post("/chat")
def chat(req: dict):
    user_id = "Ayush"  # temporary

    user_message = req.get("message", "").strip()
    
    if not user_message:
        return {
            "reply": {
                "detailed_text": "Bhai kuch toh bol… silence mein bhi I'm here but baat kar na!",
                "voice_summary": "Bol na bhai, kuch toh bolo!"
            },
            "mood": "neutral"
        }

    print("Fetching memory...")
    history = get_chat_history(user_id)
    print("History length:", len(history))

    # 1. SAVE USER MESSAGE
    print("Saving message to Supabase...")
    save_message(user_id, "user", user_message)

    result = aarya_agent(user_message, history)

    # ── Phase 3+4: Handle None (agent failed) ──
    if result is None:
        result = {
            "detailed_text": FALLBACK["aarya"],
            "voice_summary": "Ayush, thoda network ya API issue lag raha hai. Ek baar phir try karte hain."
        }

    detailed_text = result["detailed_text"]
    voice_summary  = result["voice_summary"]

    # ── Phase 7: Store ONLY detailed_text in Supabase (not voice_summary or raw JSON) ──
    if detailed_text != FALLBACK["aarya"]:
        save_message(user_id, "assistant", detailed_text)

    print(f"[AARYA] detailed_text ({len(detailed_text)} chars) | voice_summary: '{voice_summary[:60]}'")

    return {
        "reply": {
            "detailed_text": detailed_text,
            "voice_summary": voice_summary,
        },
        "mood": "neutral"
    }

@app.get("/history")
def history(user_id: str = "Ayush"):
    return {"conversations": get_chat_history(user_id)}

@app.get("/test-supabase")
def test_supabase():
    if not supabase:
        return {"status": "Failed", "error": "Supabase client not initialized."}
    try:
        supabase.table("chat_history").insert({
            "user_id": "test_system",
            "role": "system",
            "content": "Connection Test"
        }).execute()
        
        supabase.table("chat_history").select("*").eq("user_id", "test_system").execute()
        
        supabase.table("chat_history").delete().eq("user_id", "test_system").execute()
        
        return {"status": "Success", "message": "Supabase is fully implemented and working!"}
    except Exception as e:
        return {"status": "Failed", "error": str(e)}

# ── Transcription Route ──
@app.post("/transcribe")
async def transcribe_audio(audio: UploadFile = File(...)):
    """
    Accept an audio file upload and return Groq Whisper transcription.
    Supports: .wav, .mp3, .webm, .m4a
    """
    # ── MIME / Extension Validation ──
    ALLOWED_TYPES = {
        "audio/wav", "audio/mpeg", "audio/mp3",
        "audio/webm", "audio/mp4", "audio/x-m4a",
        "audio/ogg", "application/octet-stream",
    }
    ALLOWED_EXTENSIONS = {".wav", ".mp3", ".webm", ".m4a", ".ogg"}

    file_ext = os.path.splitext(audio.filename or "")[1].lower()
    content_type = (audio.content_type or "").split(";")[0].strip()

    if file_ext not in ALLOWED_EXTENSIONS and content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported audio format. Got: '{content_type}' / '{file_ext}'. Allowed: .wav, .mp3, .webm, .m4a"
        )

    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server.")

    # ── Save to Temp File ──
    suffix = file_ext if file_ext else ".webm"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            shutil.copyfileobj(audio.file, tmp)

        # ── Send to Groq Whisper API ──
        with open(tmp_path, "rb") as audio_file:
            groq_response = requests.post(
                "https://api.groq.com/openai/v1/audio/transcriptions",
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                },
                files={
                    "file": (audio.filename or f"recording{suffix}", audio_file, content_type or "audio/webm"),
                },
                data={
                    "model": "whisper-large-v3",
                    "response_format": "json",
                    "language": "en",
                },
                timeout=30,
            )

        if groq_response.status_code != 200:
            print(f"[AARYA/Transcribe] Groq error {groq_response.status_code}: {groq_response.text}")
            raise HTTPException(
                status_code=502,
                detail=f"Groq Whisper API error: {groq_response.json().get('error', {}).get('message', 'Unknown error')}"
            )

        result = groq_response.json()
        transcribed_text = result.get("text", "").strip()
        print(f"[AARYA/Transcribe] Success: '{transcribed_text[:60]}...' " if len(transcribed_text) > 60 else f"[AARYA/Transcribe] Success: '{transcribed_text}'")
        return {"text": transcribed_text}

    except HTTPException:
        raise  # Re-raise HTTP exceptions as-is
    except Exception as e:
        print(f"[AARYA/Transcribe] ERROR: {e}")
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")
    finally:
        # ── Always cleanup temp file ──
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
            print(f"[AARYA/Transcribe] Cleaned up temp file: {tmp_path}")