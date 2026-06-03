import os
import asyncio
import traceback
import gc
import json
import tempfile
import shutil
import requests
import time
import base64
import logging

logger = logging.getLogger("aarya.main")

AARYA_MODEL         = os.environ.get("AARYA_MODEL", "gemini-2.0-flash-exp")
AARYA_VOICE_PROFILE = os.environ.get("AARYA_VOICE_PROFILE", "Aoede")
STREAM_TIMEOUT_S    = float(os.environ.get("AARYA_STREAM_TIMEOUT", "30"))
MAX_HISTORY_TURNS   = int(os.environ.get("AARYA_MAX_HISTORY", "20"))
import io
import wave
import re
from fastapi import FastAPI, UploadFile, File, HTTPException, Form
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from tavily import TavilyClient
from supabase import create_client
from pydantic import BaseModel

# Load environment variables dynamically via absolute path
backend_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path = os.path.join(backend_dir, ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
    print(f"[AARYA] Loaded environment variables from: {dotenv_path}")
else:
    load_dotenv()
    print("[AARYA] Loaded environment variables using default fallback.")
# Import state machine configurations
from state_machine import fsm, STATE

# Google GenAI SDK configuration
from google import genai
from google.genai import types

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
AARYA_VOICE_PROFILE = os.getenv("AARYA_VOICE_PROFILE", "Aoede")
client = None
conversation_history = []

if GEMINI_API_KEY:
    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        print("[AARYA] Global Google GenAI Client initialized successfully.")
    except Exception as e:
        print(f"[ANTIGRAVITY BACKEND CRASH LOG]: {str(e)}")
        import traceback
        traceback.print_exc()

app = FastAPI()

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Groq, Tavily & Supabase Config ──
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

# ── Desktop Integration State & State Machine Cache ──
import ctypes

def get_os_boot_time():
    try:
        # GetTickCount64 returns milliseconds since system startup on Windows
        ms_since_boot = ctypes.windll.kernel32.GetTickCount64()
        boot_time = time.time() - (ms_since_boot / 1000.0)
        return boot_time
    except Exception:
        return 0.0

STATE_CACHE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state_cache.json")

def load_state_cache():
    boot_time = get_os_boot_time()
    if os.path.exists(STATE_CACHE_FILE):
        try:
            with open(STATE_CACHE_FILE, "r") as f:
                data = json.load(f)
            # Match boot time within 10 seconds margin to confirm active uptime session
            if abs(data.get("boot_time", 0.0) - boot_time) < 10.0:
                return data
        except Exception as e:
            print(f"[AARYA] State cache load error: {e}")
            
    # Session reset or cold boot
    new_data = {
        "boot_time": boot_time,
        "state": 0,
        "greeting_played": False
    }
    save_state_cache(new_data)
    return new_data

def save_state_cache(data):
    try:
        with open(STATE_CACHE_FILE, "w") as f:
            json.dump(data, f)
    except Exception as e:
        print(f"[AARYA] State cache save error: {e}")

last_frontend_heartbeat = 0.0
wake_triggered = False
DEFAULT_LANGUAGE = "english"
DEFAULT_VOICE_TYPE = "female"
DEFAULT_VOICE_SPEED = "fast"

@app.get("/api/v1/state")
async def get_aarya_state_v1():
    # Map STATE to numeric values for desktop_listener.py
    current_state = 0
    if fsm.state == STATE.ACTIVE:
        current_state = 2
    elif fsm.state == STATE.CONFIRM:
        current_state = 1
    return {
        "current_state": current_state,
        "greeting_played": fsm.state != STATE.DORMANT,
        "boot_time": 0.0
    }



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
async def startup_event():
    print("[Startup] AARYA Backend v2.5.0 initializing...")
    
    # 1. Supabase Check
    if not supabase:
        print("[SUPABASE] CONNECTION FAILED: Client not initialized.")
    else:
        try:
            supabase.table("chat_history").select("*").limit(1).execute()
            print("[SUPABASE] CONNECTED SUCCESSFULLY")
        except Exception as e:
            print(f"[SUPABASE] CONNECTION FAILED: {str(e)}")
            
    # 2. Warm-up Handshake
    from startup import run_warmup_handshake
    result = await run_warmup_handshake()
    app.state.api_status = result["status"]
    
    if result["status"] == "CONFIG_ERROR":
        print(f"[Startup] API key invalid. Voice pipeline will not function. {result}")
        app.state.mic_handler_enabled = False
    elif result["status"] == "AVAILABLE":
        print("[Startup] Gemini API reachable. Voice pipeline ready.")
        app.state.mic_handler_enabled = True
    else:
        print(f"[Startup] API degraded. Will retry on first query. {result}")
        app.state.mic_handler_enabled = True

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
# ── Neural Voice Mapping ──
VOICE_MAPPING = {
    ("hinglish", "female"): "en-IN-NeerjaNeural",
    ("hinglish", "male"): "en-IN-PrabhatNeural",
    ("hindi", "female"): "en-IN-NeerjaNeural",
    ("hindi", "male"): "en-IN-PrabhatNeural",
    ("english", "female"): "en-IN-NeerjaNeural",
    ("english", "male"): "en-IN-PrabhatNeural",
}

import re

def normalize_hinglish_for_tts(text: str) -> str:
    """
    Cleans up technical words, acronyms, and common Hinglish/Hinglish-English terms
    so that Microsoft's Neural Indian voices pronounce them with perfect native flow,
    preventing robotic spelling-out behavior.
    """
    if not text:
        return ""
        
    # Replace AARYA with Aarya to prevent spelling it out
    text = text.replace("AARYA", "Aarya")
    text = text.replace("aarya", "Aarya")
    
    # Acronyms mapping for standard pronunciation (spelling them out naturally)
    acronyms = {
        "API": "A-P-I",
        "api": "A-P-I",
        "IPC": "I-P-C",
        "ipc": "I-P-C",
        "TTS": "T-T-S",
        "tts": "T-T-S",
        "STT": "S-T-T",
        "stt": "S-T-T",
        "UI": "U-I",
        "ui": "U-I",
        "UX": "U-X",
        "ux": "U-X",
        "URL": "U-R-L",
        "url": "U-R-L",
        "HTML": "H-T-M-L",
        "html": "H-T-M-L",
        "CSS": "C-S-S",
        "css": "C-S-S",
        "HMR": "H-M-R",
        "hmr": "H-M-R",
        "FastAPI": "Fast A-P-I",
        "fastapi": "Fast A-P-I",
        "Next.js": "Next J-S",
        "next.js": "Next J-S",
        "JSX": "J-S-X",
        "jsx": "J-S-X",
        "JSON": "J-S-O-N",
        "json": "J-S-O-N",
        "SQL": "S-Q-L",
        "sql": "S-Q-L",
        "DB": "D-B",
        "db": "D-B",
    }
    
    # Split text into tokens and replace whole word matches or substring acronyms
    words = text.split()
    normalized_words = []
    for w in words:
        # Strip trailing/leading punctuation
        clean_w = w.strip(".,!?()[]{}\"'")
        if clean_w in acronyms:
            replaced = w.replace(clean_w, acronyms[clean_w])
            normalized_words.append(replaced)
        else:
            normalized_words.append(w)
            
    text = " ".join(normalized_words)
    
    # Symbols cleaning
    text = text.replace("&", " and ")
    text = text.replace("@", " at ")
    text = text.replace("#", "")
    
    return text

# === ANTIGRAVITY FORCE PATCH: MANDATORY AUDIO SANITIZATION ===
import re

def strictly_clean_audio_text(raw_llm_text: str) -> str:
    if not raw_llm_text:
        return ""
    # 1. Remove entire markdown code blocks completely (including content inside)
    clean_text = re.sub(r'```[a-zA-Z]*\n[\s\S]*?```', '', raw_llm_text)
    # 2. Remove inline code snippets (e.g., `code`)
    clean_text = re.sub(r'`[^`]+`', '', clean_text)
    # 3. Remove all http/https/www URLs completely
    clean_text = re.sub(r'https?://\S+|www\.\S+', '', clean_text)
    # 4. Strip out all remaining markdown syntax markers (*, #, _, [, ], (, ))
    clean_text = re.sub(r'[\*#`_\[\]\(\)]', '', clean_text)
    # 5. Clean up multiple spaces or lingering single slashes
    clean_text = re.sub(r'\s+', ' ', clean_text).strip()
    return clean_text

def clean_text_for_tts(text: str) -> str:
    """
    Sanitizes raw model output into conversational, speech-friendly text:
    - Strips markdown formatting (headers, bold, italics, code blocks, lists).
    - Transforms symbols, raw URLs, and excessive punctuation to maintain cadence.
    - Prevents stuttering or literal spelling-out of syntax symbols.
    """
    if not text:
        return ""

    # Apply strict absolute sanitization
    text = strictly_clean_audio_text(text)

    # Technical symbols that break cadence or get spelled out
    symbols_to_strip = ["|", "\\", "/", "_", "~", "+", "=", "-", "$", "@"]
    for s in symbols_to_strip:
        text = text.replace(s, " ")

    # Strip emojis and exotic non-standard unicode characters
    text = re.sub(r'[^\x00-\x7F\u0900-\u097F\u200b-\u200d\u200f\ufeff]+', ' ', text)

    # Normalize Hinglish phonetics and acronyms
    text = normalize_hinglish_for_tts(text)

    # Clean up extra whitespaces, duplicate punctuations, and micro-pauses
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\.+", ".", text)
    text = re.sub(r"\?,", "?", text)
    text = re.sub(r"\!,", "!", text)
    
    return text.strip()

def preprocess_for_tts(text: str) -> str:
    """
    Locally overwrites imported preprocess_for_tts to ensure unified robust regex sanitization.
    """
    return clean_text_for_tts(text)





def enforce_smart_voice_summary(voice_summary: str, detailed_text: str) -> str:
    """
    Ensures the voice summary is rich, self-contained, and completely free of lazy placeholder phrases.
    If the voice summary contains a lazy phrase, is too short, or lacks descriptive density, 
    dynamically extracts the core conversational insight (3-4 sentences) from the detailed text as a fallback.
    """
    blacklist = [
        "check your screen", "check screen", "take a look", "displayed above", "shown on screen", 
        "screen pe dekh", "dekh lo", "dekh sakte ho", "i have displayed", "displayed it", 
        "shown below", "look above", "look at the ui", "look at the screen", "available on screen",
        "detailed response is", "breakdown screen pe", "as an ai", "please check the screen",
        "displayed below", "here is a short answer", "hope this helps", "robotic disclaimer"
    ]
    
    voice_clean = voice_summary.strip()
    val = voice_clean.lower()
    has_lazy = any(phrase in val for phrase in blacklist)
    
    # Split into sentences to verify sentence count
    sentences_in_voice = [s.strip() for s in re.split(r'(?<=[.!?।])\s+', voice_clean) if s.strip()]
    
    # If clean, has between 3 and 4 sentences, and is long enough, return it
    if not has_lazy and 3 <= len(sentences_in_voice) <= 4 and len(voice_clean) >= 90:
        return voice_clean
        
    # Otherwise, extract conversational sentences from detailed_text
    print(f"[AARYA/Sanitizer] Voice summary lacks depth or has forbidden patterns: '{voice_summary}'. Generating robust 3-4 sentence conversational fallback...")
    
    clean_detail = clean_text_for_tts(detailed_text)
    # Split into sentences
    sentences = re.split(r'(?<=[.!?।])\s+', clean_detail)
    # Keep the first 4 sentences that are informative and don't contain blacklist phrases
    good_sentences = []
    for s in sentences:
        s_clean = s.strip()
        if not s_clean:
            continue
        # Skip if sentence has a blacklist phrase or is code
        s_lower = s_clean.lower()
        if any(phrase in s_lower for phrase in blacklist):
            continue
        if len(s_clean) < 20: # skip extremely short lines/fragments
            continue
        good_sentences.append(s_clean)
        if len(good_sentences) == 4:
            break
            
    if len(good_sentences) >= 3:
        fallback_summary = " ".join(good_sentences[:4])
        print(f"[AARYA/Sanitizer] Generated smart 3-4 sentence voice summary fallback: '{fallback_summary}'")
        return fallback_summary
    elif good_sentences:
        # If we have at least 1-2 sentences but not 3, pad it with premium professional engineering tone
        fallback_paddings = [
            "I have compiled the complete structured analysis and displayed the primary findings for you.",
            "These represent the most critical developments and implications happening right now.",
            "Please review the detailed technical breakdown on your screen for additional architecture."
        ]
        padding_idx = 0
        while len(good_sentences) < 3:
            good_sentences.append(fallback_paddings[padding_idx % len(fallback_paddings)])
            padding_idx += 1
        fallback_summary = " ".join(good_sentences[:4])
        print(f"[AARYA/Sanitizer] Padded and generated voice summary: '{fallback_summary}'")
        return fallback_summary
        
    return "I have compiled the complete structured analysis on your screen. The dual layer screen payload contains all relevant system details."


# ── Google GenAI Native Multimodal Audio Helpers ──

def pcm_to_wav(pcm_bytes: bytes, sample_rate: int = 24000) -> bytes:
    buffer = io.BytesIO()
    with wave.open(buffer, 'wb') as wf:
        wf.setnchannels(1)          # Mono
        wf.setsampwidth(2)          # 16-bit = 2 bytes
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return buffer.getvalue()

VOICE_FALLBACK_CHAIN = ["Aoede", "Kore", "Fenrir", "Puck"]

async def generate_gemini_audio_with_fallback(text: str, model_name: str = "gemini-2.5-flash") -> bytes:
    """
    Generates audio bytes using Gemini native multimodal audio ONLY.
    NO pyttsx3, NO edge_tts, NO SAPI fallbacks.
    Returns PCM WAV bytes.
    """
    # AI Studio Gemini 2.5 Flash only supports audio output under the -preview-tts variant.
    if model_name == "gemini-2.5-flash":
        model_name = "gemini-2.5-flash-preview-tts"

    if client:
        # Try each voice in order: Aoede, Kore, Fenrir
        voices = ["Aoede", "Kore", "Fenrir"]
        for voice_name in voices:
            try:
                print(f"[AARYA/Audio] Generating native audio using voice: '{voice_name}' for: '{text[:50]}...'")
                response = await client.aio.models.generate_content(
                    model=model_name,
                    contents=text,
                    config=types.GenerateContentConfig(
                        response_modalities=["AUDIO"],
                        speech_config=types.SpeechConfig(
                            voice_config=types.VoiceConfig(
                                prebuilt_voice_config=types.PrebuiltVoiceConfig(
                                    voice_name=voice_name
                                )
                            )
                        ),
                    ),
                )
                for part in response.candidates[0].content.parts:
                    if part.inline_data is not None:
                        return pcm_to_wav(part.inline_data.data)
            except Exception as e:
                print(f"[AARYA/Audio] Native voice '{voice_name}' failed: {e}. Trying next...")
    else:
        print("[AARYA/Audio] Google GenAI Client is not initialized.")
        
    return None

async def generate_confirmation_audio() -> bytes:
    """
    STATE 1 ONLY. Generates audio bytes for the fixed readiness confirmation.
    First tries loading from local cached assets/fallback_confirm.wav for zero latency.
    """
    fallback_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets", "fallback_confirm.wav")
    if os.path.exists(fallback_path):
        try:
            print("[AARYA/Audio] Loading pre-cached State 1 confirmation audio (0ms API latency)")
            with open(fallback_path, "rb") as f:
                return f.read()
        except Exception as e:
            print(f"[AARYA/Audio] Failed to read cached activation WAV: {e}")
            
    # Call Gemini to generate it
    try:
        # Retry once with 500ms delay if it fails
        for attempt in range(2):
            try:
                audio = await generate_gemini_audio_with_fallback("Yes sir, I am listening.")
                if audio:
                    return audio
            except Exception as e:
                print(f"[AARYA/Audio] Confirmation attempt {attempt + 1} failed: {e}")
                if attempt == 0:
                    await asyncio.sleep(0.5)
    except Exception as e:
        print(f"[AARYA/Audio] Failed to generate confirmation audio: {e}")
        
    return None


@app.get("/api/tts")
async def get_tts(text: str, language: str = "english", voice_type: str = "female", voice_speed: str = "fast"):
    """
    Generates and streams native Gemini audio for the given text payload (WAV format, 24kHz).
    """
    clean_text = strictly_clean_audio_text(text)
    if not clean_text:
        clean_text = "Yes, I am listening."
        
    print(f"[AARYA/TTS] Text: '{text[:40]}...' | Cleaned: '{clean_text[:40]}...'")
    
    try:
        # Generate native Gemini audio WAV bytes
        audio_bytes = await generate_gemini_audio_with_fallback(clean_text)
        if not audio_bytes:
            raise HTTPException(status_code=500, detail="Gemini audio generation failed")
            
        return StreamingResponse(io.BytesIO(audio_bytes), media_type="audio/wav")
    except Exception as e:
        print(f"[AARYA/TTS] Synthesis failed: {e}")
        raise HTTPException(status_code=500, detail=f"TTS synthesis failed: {e}")

@app.post("/api/synthesize")
async def synthesize_speech(req: dict):
    """
    Synthesizes and returns base64-encoded native audio bytes for the given text.
    """
    text = req.get("text", "").strip()
    if not text:
        return {"status": "ignored", "action": "no_audio"}
        
    clean_text = strictly_clean_audio_text(text)
    print(f"[AARYA/Synthesize] Text: '{text[:40]}...' | Cleaned: '{clean_text[:40]}...'")
    
    try:
        audio_bytes = await generate_gemini_audio_with_fallback(clean_text)
        base64_audio = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
        
        # If currently in CONFIRM state, advance to ACTIVE/operational state
        if await fsm.get_state() == AARYAState.CONFIRM:
            await fsm.on_activation_complete()
            
        return {
            "status": "success",
            "audio_bytes": base64_audio,
            "text_preview": text[:80]
        }
    except Exception as e:
        print(f"[AARYA/Synthesize] Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

FALLBACK = {
    "aarya": "Ayush, it seems there's a temporary network or API issue. Let's try that again in a moment.",
    "mood": "neutral"
}

SYSTEM_PROMPT = """You are AARYA — a highly intelligent AI companion running as a desktop assistant.
Your purpose is to function as a trusted intellectual equal: sharp, direct, conversational, and genuinely useful engineering peer.

RESPONSE DUAL-BIFURCATION REQUIREMENTS (MANDATORY):
Every query must be answered with a valid JSON containing exactly two keys:
1. "screen": The complete, high-caliber, deep-dive analytical response formatted in rich, professional Markdown for screen display. Use ## headings, ### subheadings, and - bullet points. Minimum 2 subheadings. Minimum 3 bullets per section. Exhaustive and structured.
2. "audio": A conversational, spoken overview in plain prose for real-time audio playback. This key must never contain markdown syntax, URL strings, asterisks, backticks, or lists.

SCREEN LAYER (UI DISPLAY) DESIGN GUIDELINES:
- Deliver deep technical depth with zero hand-waving.
- Use structured markdown layouts:
  * Clean Headings (##) for primary sections
  * Subheadings (###) for technical breakdowns
  * Dense, informative bullet points using '-' prefix (not '*')
  * Bold (`**`) key terms and code block integrations
- Minimum depth: 2 subheadings, 3 bullets per subheading.

AUDIO LAYER (AUDIO PLAYBACK) DESIGN GUIDELINES (non-negotiable):
- Speak directly to Ayush as a brilliant close friend. Write only for the ear, never for the eye.
- Never use Markdown in spoken responses. No asterisks, no hashes, no backticks, no bullet points, no numbered lists, no URL strings.
- Never say URLs. If a resource is relevant, describe it by name only: "the official Python documentation" not "https://docs.python.org".
- Never open with hollow affirmations: no "Great question!", "Certainly!", "Of course!", "Sure!", or "Absolutely!". Start with substance.
- Never narrate structure. Do not say "First..., Second..., Third..." or "Here are three things:". Speak in flowing, connected prose sentences.
- Factual queries: 2–3 spoken sentences.
- Analytical / explanatory queries: 4–6 spoken sentences.
- Complex technical walkthroughs: up to 8 sentences, but never more. If more depth is needed, pause and ask what direction to go.
- Match the conversational energy of the user. If you don't know something, say so plainly and immediately.
- One unsolicited but relevant follow-on insight per response, maximum. State it as a natural extension of the conversation.

STRICT JSON OUTPUT FORMAT — MANDATORY, NON-NEGOTIABLE
You MUST ALWAYS respond with EXACTLY this JSON structure:
{
  "screen": "<Full Markdown documentation response. Use ## headings, ### subheadings, and - bullet points. Minimum 2 subheadings. Minimum 3 bullets per section. Exhaustive and structured.>",
  "audio": "<Conversational spoken summary conforming perfectly to the intelligent friend guidelines. Plain prose only, no markdown, no URLs, no structure narration. 3-6 sentences max.>"
}
"""

VISION_SYSTEM_PROMPT = """You are AARYA, the elite personal engineering AI partner and visual OS companion to Ayush Naraniwal. You analyze active system windows, IDE editors, compiling errors, or Chandigarh University portals via real-time screenshots and deliver co-founder-grade insights.

Your vocal persona is that of an ultra-confident, highly articulate engineering peer. Speak to Ayush directly in the second person ("you", "your"). Avoid any visual disclaimers ("Based on the screenshot...") or robotic report structures. Speak naturally like a co-developer sitting right next to him.

RESPONSE DUAL-BIFURCATION REQUIREMENTS (MANDATORY):
Every visual query must be answered with a valid JSON containing exactly two keys:
1. "screen": Deep technical debugging or screen analysis in rich markdown (## headings, ### subheadings, bold terms, code fixes). Use ## headings, ### subheadings, and - bullet points. Minimum 2 subheadings. Minimum 3 bullets per section. Exhaustive and structured.
2. "audio": A standalone 3-to-4 sentence spoken overview in fluent professional English that captures the core thesis and practical debugging resolution immediately. No screen references or polite fillers. Plain prose only, no markdown.

STRICT JSON OUTPUT FORMAT — MANDATORY, NON-NEGOTIABLE
You MUST ALWAYS respond with EXACTLY this JSON structure:
{
  "screen": "<Deep technical debugging or screen analysis in rich markdown with ## headings, ### subheadings, and - bullet points. Minimum 2 subheadings. Minimum 3 bullets per section.>",
  "audio": "<Exactly 3-4 sentence spoken summary. No markdown. Plain prose only. Sentence 1: direct answer. Sentence 2: key context. Sentence 3: implication or next step. Sentence 4 optional: follow-up invitation. High-energy, confident, peer-level tone.>"
}
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
def aarya_agent(user_message, history, language="english", voice_speed="fast"):
    # Step 1: Decide if a real-time web search is needed
    real_time_phrases = ["happening", "what's new", "going on", "latest", "news", "weather", "today", "current", "price", "live", "trending", "sports", "politics", "market", "recent launch", "breakthrough", "recent update", "tech updates", "world right now", "ai right now"]
    use_search = any(phrase in user_message.lower() for phrase in real_time_phrases)

    web_context = ""
    if use_search:
        print(f"[AARYA] Tavily search triggered for: {user_message}")
        results = search_web(user_message)
        if results:
            # Summarise results cleanly — cap snippet character length to prevent Groq 413/429 TPM limits (6000 TPM limit)
            snippets = []
            for r in results:
                content = r.get("content", "").strip()
                if content:
                    # Cap each snippet to 600 characters
                    snippets.append(content[:600])
            web_context = "\n\n".join(snippets[:3])  # cap at 3 results

    # Step 2: Build the language preference note
    lang_preference_note = "\n\nCRITICAL: You are strictly hard-locked to fluent standard English. Respond in natural, high-quality standard English with a supportive, friendly context."

    # Step 3: Check if Google GenAI Gemini is available via API key
    gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if gemini_key:
        print("[AARYA] Using native Google GenAI SDK with Gemini...")
        try:
            global client
            from google import genai
            from google.genai import types
            from pydantic import BaseModel, Field

            class AaryaResponse(BaseModel):
                screen: str = Field(description="Full Markdown documentation response. Use ## headings, ### subheadings, and - bullet points. Minimum 2 subheadings. Minimum 3 bullets per section. Exhaustive and structured.")
                audio: str = Field(description="Exactly 3-4 sentence spoken summary. No markdown. Plain prose only. Sentence 1: direct answer. Sentence 2: key context. Sentence 3: implication or next step. Sentence 4 optional: follow-up invitation. High-energy, confident, peer-level tone.")

            client = genai.Client(api_key=gemini_key)
            
            # Convert history to Gemini format (roles: user, model)
            contents = []
            if history:
                for msg in history:
                    role = "user" if msg["role"] == "user" else "model"
                    contents.append(types.Content(
                        role=role,
                        parts=[types.Part.from_text(text=msg["content"])]
                    ))
            
            # Inject web context if search was used
            if web_context:
                contents.append(types.Content(
                    role="user",
                    parts=[types.Part.from_text(text=f"Real-time web search context (Tavily):\n{web_context}")]
                ))
                contents.append(types.Content(
                    role="model",
                    parts=[types.Part.from_text(text="Understood. I will integrate this real-time data into my response as AARYA.")]
                ))

            # Add current user message
            contents.append(types.Content(
                role="user",
                parts=[types.Part.from_text(text=user_message)]
            ))

            system_instruction = SYSTEM_PROMPT + lang_preference_note

            response = client.models.generate_content(
                model='gemini-2.5-flash',
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.7,
                    response_mime_type="application/json",
                    response_schema=AaryaResponse
                )
            )

            # Parse and validate response
            raw_text = response.text
            parsed = json.loads(raw_text)
            
            detailed_text = parsed.get("screen") or parsed.get("detailed_text") or raw_text
            voice_summary = parsed.get("audio") or parsed.get("voice_summary") or ""
            voice_summary = enforce_smart_voice_summary(voice_summary, detailed_text)

            return {
                "detailed_text": str(detailed_text).strip(),
                "voice_summary": str(voice_summary).strip()
            }

        except Exception as e:
            print(f"[ANTIGRAVITY BACKEND CRASH LOG]: {str(e)}")
            import traceback
            traceback.print_exc()
            print(f"[AARYA/Gemini] Native Gemini SDK execution failed: {e}. Falling back to Groq...")

    # Step 4: Fall back to Groq (original pathway)
    print("[AARYA] Running Groq backend pathway...")
    messages = [{"role": "system", "content": SYSTEM_PROMPT + lang_preference_note}]

    if history:
        messages.extend(history)
        print(f"[AARYA] Context window: {len(history)} prior messages injected")
    else:
        print("[AARYA] No prior context — fresh conversation")

    if web_context:
        messages.append({
            "role": "system",
            "content": (
                "Real-time web data for this query (Tavily). "
                "Synthesize this naturally into your response as AARYA — never paste raw:\n\n"
                + web_context
            ),
        })

    messages.append({"role": "user", "content": user_message})

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
        "response_format": {"type": "json_object"},
    }

    try:
        print("---- REQUEST DEBUG (Groq) ----")
        resp = requests.post(GROQ_URL, headers=headers, json=payload, timeout=TIMEOUT)
        
        # Self-healing fallback: If 429 Rate Limit hit (TDoT limit on Llama-3.3-70b-versatile), retry with Llama-3.1-8b-instant
        if resp.status_code == 429:
            print("[AARYA/RateLimit] Llama 3.3 70B rate limited. Retrying with Llama 3.1 8B Instant...")
            payload["model"] = "llama-3.1-8b-instant"
            resp = requests.post(GROQ_URL, headers=headers, json=payload, timeout=TIMEOUT)

        if resp.status_code != 200:
            print(f"[AARYA] ERROR: API returned status {resp.status_code}. Response: {resp.text}")
            return None
            
        raw_content = resp.json()["choices"][0]["message"]["content"]
        
        try:
            parsed = json.loads(raw_content)
        except (json.JSONDecodeError, TypeError):
            parsed = {}

        detailed_text = parsed.get("screen") or parsed.get("detailed_text") or raw_content or FALLBACK["aarya"]
        voice_summary = parsed.get("audio") or parsed.get("voice_summary") or ""
        voice_summary = enforce_smart_voice_summary(voice_summary, detailed_text)

        if not str(detailed_text).strip():
            detailed_text = FALLBACK["aarya"]

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

@app.get("/health")
async def health():
    from config import GEMINI_MODEL
    return {
        "status": "ok",
        "model": GEMINI_MODEL,
        "voice_pipeline": "gemini_native_only",
        "legacy_tts": "purged",
        "version": "2.5.0"
    }

is_speaking = False

@app.post("/api/playback-state")
def post_playback_state(req: dict):
    global is_speaking
    is_speaking = bool(req.get("is_playing", False))
    return {"status": "ok", "is_speaking": is_speaking}

@app.get("/api/playback-state")
def get_playback_state():
    global is_speaking
    return {"is_speaking": is_speaking}

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

# Define system prompt alias
AARYA_SYSTEM_PROMPT = SYSTEM_PROMPT

class QueryRequest(BaseModel):
    text: str

@app.post("/api/wake")
async def route_wake():
    """
    Triggers State-1. Returns pre-cached audio (or text fallback).
    Never raises. Never calls Gemini. Never blocks.
    """
    try:
        res = await fsm.trigger_wake()
        # Programmatic fallback: instantly toggle state to ACTIVE after delivering confirmation audio block
        await fsm.confirm_played()
        return res
    except Exception as exc:
        logger.error("[AARYA /api/wake] Unexpected exception: %s", exc)
        fsm._state = STATE.ACTIVE
        return {
            "status": "confirm",
            "state": STATE.ACTIVE,
            "response_type": "text",
            "audio": None,
            "text": "Yes sir, I am listening.",
        }

@app.post("/api/confirm_played")
async def route_confirm_played():
    """Frontend fires this when State-1 greeting finishes playing/displaying."""
    return await fsm.confirm_played()

@app.post("/api/dismiss")
async def route_dismiss():
    """Resets FSM to DORMANT. Clears conversation history."""
    global conversation_history
    conversation_history = []
    return await fsm.dismiss()

@app.get("/api/state")
async def route_get_state():
    """Diagnostic: returns current FSM state. Useful for frontend polling."""
    return {"state": fsm.state}

@app.post("/api/query")
async def route_query(request: QueryRequest):
    """
    Streams a Gemini multimodal response as NDJSON.

    CONFIRM state → 503 Retry-After (not 403 — the watchdog will release it).
    DORMANT state → 403 Forbidden.
    ACTIVE state  → StreamingResponse.
    """
    if fsm.state == STATE.CONFIRM:
        print("[AARYA/FSM] State transition override log: CONFIRM -> ACTIVE forced by route_query")
        await fsm.confirm_played()

    try:
        fsm.assert_active()
    except ValueError as exc:
        msg = str(exc)
        if "CONFIRM" in msg:
            raise HTTPException(
                status_code=503,
                detail=msg,
                headers={"Retry-After": "2"},
            )
        raise HTTPException(status_code=403, detail=msg)

    fsm.ping_activity()

    from config import GEMINI_MODEL
    
    return StreamingResponse(
        _stream_query_interceptor(request.text),
        media_type="application/x-ndjson",
        headers={
            "X-AARYA-Model": GEMINI_MODEL,
            "X-AARYA-Voice": AARYA_VOICE_PROFILE,
            "X-Accel-Buffering": "no",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Transfer-Encoding": "chunked",
        },
    )

async def _stream_query_interceptor(user_text: str):
    global conversation_history
    
    from config import (
        GEMINI_MODEL,
        STREAM_TIMEOUT_SECONDS,
        MAX_RETRY_ATTEMPTS,
        RETRY_BACKOFF_SECONDS,
    )
    from stream_interceptor import GeminiStreamInterceptor

    interceptor = GeminiStreamInterceptor(
        model=GEMINI_MODEL,
        voice=AARYA_VOICE_PROFILE,  # Use current active profile voice
        timeout=STREAM_TIMEOUT_SECONDS,
        max_retries=MAX_RETRY_ATTEMPTS,
        retry_backoff=RETRY_BACKOFF_SECONDS,
    )

    text_parts = []
    async for frame in interceptor.stream(query=user_text, history=conversation_history):
        yield frame
        
        # Accumulate text chunks to update conversation history
        try:
            parsed = json.loads(frame.strip())
            if parsed.get("type") == "text":
                text_parts.append(parsed.get("data", ""))
        except Exception:
            pass

    full_text = "".join(text_parts)
    if full_text:
        _append_history("user", user_text)
        _append_history("model", full_text)

async def stream_groq_fallback(user_input: str, history: list, start_seq: int = 0):
    seq = start_seq
    print("[AARYA/Stream] Entering Groq fallback streaming pathway...")
    GROQ_API_KEY = os.getenv("GROQ_API_KEY")
    if not GROQ_API_KEY:
        yield _make_frame(seq, "error", "GROQ_API_KEY is not defined.")
        return

    headers = {
        "Authorization": f"Bearer {GROQ_API_KEY}",
        "Content-Type": "application/json"
    }
    
    messages = [
        {"role": "system", "content": "You are AARYA — a highly intelligent AI companion and peer. Speak directly to Ayush. Respond in clean, natural, flowing conversational English prose. Keep it under 6 sentences. Do NOT use markdown headers, asterisks, list bullet points, backticks, code blocks, or raw URLs. Write exactly how you want your voice output to sound."}
    ]
    if history:
        for msg in history:
            role = "assistant" if msg["role"] == "model" or msg["role"] == "assistant" else "user"
            content = msg.get("content") or msg.get("parts", [{}])[0].get("text", "")
            messages.append({"role": role, "content": content})
    messages.append({"role": "user", "content": user_input})
    
    payload = {
        "model": "llama-3.3-70b-versatile",
        "messages": messages,
        "temperature": 0.7,
        "stream": True
    }
    
    try:
        def run_post():
            return requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, stream=True, timeout=10.0)
            
        resp = await asyncio.to_thread(run_post)
        
        if resp.status_code == 429:
            print("[AARYA/Stream] Llama 3.3 70B rate limited. Retrying with Llama 3.1 8B Instant...")
            payload["model"] = "llama-3.1-8b-instant"
            resp = await asyncio.to_thread(run_post)
            
        if resp.status_code != 200:
            yield _make_frame(seq, "error", f"Groq stream error: {resp.text}")
            return
            
        current_sentence = []
        
        for line in resp.iter_lines():
            if line:
                decoded_line = line.decode('utf-8').strip()
                if decoded_line.startswith("data: "):
                    data_str = decoded_line[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        parsed = json.loads(data_str)
                        delta = parsed["choices"][0]["delta"]
                        content = delta.get("content", "")
                        if content:
                            yield _make_frame(seq, "text", content)
                            seq += 1
                            
                            current_sentence.append(content)
                            sentence_str = "".join(current_sentence)
                            
                            if any(sentence_str.endswith(p) for p in [".", "!", "?", "।"]):
                                clean_sent = strictly_clean_audio_text(sentence_str)
                                if len(clean_sent) > 5:
                                    try:
                                        audio_bytes = await generate_gemini_audio_with_fallback(clean_sent)
                                        if audio_bytes:
                                            if audio_bytes.startswith(b"RIFF"):
                                                raw_pcm = audio_bytes[44:] if len(audio_bytes) > 44 else audio_bytes
                                            else:
                                                raw_pcm = audio_bytes
                                            base64_audio = base64.b64encode(raw_pcm).decode("utf-8")
                                            print(f"[AUDIO CHUNK YIELD]: Yielding {len(raw_pcm)} bytes (Groq fallback)")
                                            yield _make_frame(seq, "audio", base64_audio)
                                            seq += 1
                                    except Exception as e:
                                        print(f"[AUDIO ERROR]: {e}")
                                current_sentence.clear()
                    except Exception:
                        pass
                        
        yield _make_frame(seq, "done", "")
        seq += 1
    except Exception as e:
        yield _make_frame(seq, "error", f"Groq fallback error: {str(e)}")

def _make_frame(seq: int, frame_type: str, data) -> str:
    """Single NDJSON frame terminated by newline. The ONLY frame constructor."""
    return json.dumps(
        {"seq": seq, "type": frame_type, "data": data},
        ensure_ascii=False,
    ) + "\n"


def _append_history(role: str, text: str) -> None:
    global conversation_history
    conversation_history.append({"role": role, "parts": [{"text": text}]})
    cap = MAX_HISTORY_TURNS * 2
    if len(conversation_history) > cap:
        conversation_history = conversation_history[-cap:]

@app.post("/api/ambient-query")
async def ambient_query(req: dict):
    global DEFAULT_LANGUAGE, DEFAULT_VOICE_TYPE, DEFAULT_VOICE_SPEED
    query = req.get("query", "").strip()
    language = req.get("language") or DEFAULT_LANGUAGE
    print(f"[AARYA/Backend] Ambient Query received: '{query}' | language: '{language}'")

    if not query:
        return {"status": "ignored", "reason": "empty query"}

    query_lower = query.lower()

    # ── Stop Triggers ──
    stop_triggers = ["stop", "cancel", "quiet", "silence", "shh", "stop speaking"]
    is_stop = any(trigger == query_lower or query_lower.startswith(trigger + " ") or query_lower.endswith(" " + trigger) for trigger in stop_triggers)
    if is_stop:
        print("[AARYA/Backend] Ambient Stop Command detected! Sending stop command to Electron...")
        try:
            res = requests.post("http://127.0.0.1:3001/stop", timeout=1.0)
            return {"status": "stopped", "electron_response": res.json()}
        except Exception as e:
            print(f"[AARYA/Backend] Failed to communicate stop with Electron: {e}")
            return {"status": "electron_not_running", "error": str(e)}

    # ── Focus / UI Triggers ──
    focus_triggers = ["open ui", "show dashboard", "open window", "show window", "show ui", "open dashboard", "maximize", "focus ui", "focus dashboard", "maximize ui"]
    is_focus = any(trigger in query_lower for trigger in focus_triggers)
    if is_focus:
        print("[AARYA/Backend] Focus Command detected! Instructing Electron to show window...")
        try:
            payload = {
                "query": query,
                "detailedText": "### AARYA Dashboard\nBringing AARYA's desktop workspace to the foreground. Feel free to continue chatting or reviewing the system context!",
                "voiceSummary": "Sure Ayush, bringing the dashboard to the foreground right now.",
                "focus": True,
                "mood": "happy"
            }
            save_message("Ayush", "user", query)
            save_message("Ayush", "assistant", payload["detailedText"])
            res = requests.post("http://127.0.0.1:3001/ambient-response", json=payload, timeout=2.0)
            return {"status": "focused", "electron_response": res.json()}
        except Exception as e:
            print(f"[AARYA/Backend] Failed to communicate focus with Electron: {e}")
            return {"status": "electron_not_running", "error": str(e)}

    # ── State Machine Check ──
    if fsm.state == STATE.DORMANT:
        wake_res = await fsm.trigger_wake()
        greeting = wake_res.get("text", "Yes sir, I am listening.")
        detailed_text = f"### AARYA Woken\n{greeting}"
        voice_summary = greeting
        
        save_message("Ayush", "user", query)
        save_message("Ayush", "assistant", detailed_text)

        # Generate native confirmation WAV bytes
        # FSM pre-loads greeting as base64 in _confirm_audio_b64 (no method exists for raw bytes)
        audio_bytes = base64.b64decode(fsm._confirm_audio_b64) if fsm._confirm_audio_b64 else None
        base64_audio = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
        
        await fsm.confirm_played()

        try:
            res = requests.post("http://127.0.0.1:3001/ambient-response", json={
                "query": query,
                "detailedText": detailed_text,
                "voiceSummary": voice_summary,
                "audio_bytes": base64_audio,
                "focus": True,
                "mood": "happy"
            }, timeout=2.0)
            return {
                "status": "success",
                "detailed_text": detailed_text,
                "voice_summary": voice_summary,
                "audio_bytes": base64_audio,
                "electron_response": res.json()
            }
        except Exception as e:
            print(f"[AARYA/Backend] Failed to communicate response with Electron: {e}")
            return {
                "status": "success",
                "detailed_text": detailed_text,
                "voice_summary": voice_summary,
                "audio_bytes": base64_audio,
                "error": f"electron_not_running: {e}"
            }

    # ── Regular Ambient Query (State 2: Continuous Dialogue) ──
    voice_speed = req.get("voice_speed") or DEFAULT_VOICE_SPEED
    history = get_chat_history("Ayush")
    save_message("Ayush", "user", query)
    result = aarya_agent(query, history, language, voice_speed)
    
    if result is None:
        result = {
            "detailed_text": FALLBACK["aarya"],
            "voice_summary": "Ayush, thoda network ya API issue lag raha hai. Ek baar phir try karte hain."
        }
    
    detailed_text = result["detailed_text"]
    voice_summary = result["voice_summary"]
    
    # Generate native audio bytes from Gemini
    audio_bytes = await generate_gemini_audio_with_fallback(voice_summary)
    base64_audio = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
    
    save_message("Ayush", "assistant", detailed_text)

    try:
        res = requests.post("http://127.0.0.1:3001/ambient-response", json={
            "query": query,
            "detailedText": detailed_text,
            "voiceSummary": voice_summary,
            "audio_bytes": base64_audio,
            "focus": True,
            "mood": "neutral"
        }, timeout=2.0)
        return {
            "status": "success", 
            "detailed_text": detailed_text,
            "voice_summary": voice_summary,
            "audio_bytes": base64_audio,
            "electron_response": res.json()
        }
    except Exception as e:
        print(f"[AARYA/Backend] Failed to communicate response with Electron: {e}")
        return {
            "status": "success", 
            "detailed_text": detailed_text,
            "voice_summary": voice_summary,
            "audio_bytes": base64_audio,
            "error": f"electron_not_running: {e}"
        }

async def chat_stream_generator(user_message: str, history: list, user_id: str):
    accumulated_text = []
    async for frame_str in _stream_query_interceptor(user_message):
        yield frame_str
        try:
            trimmed = frame_str.strip()
            if trimmed:
                data = json.loads(trimmed)
                if data.get("type") == "text":
                    accumulated_text.append(data.get("data", ""))
        except Exception:
            pass
            
    full_response = "".join(accumulated_text).strip()
    if full_response:
        save_message(user_id, "assistant", full_response)
        print(f"[AARYA/Chat] Saved assistant message to Supabase: {full_response[:60]}...")

@app.post("/chat")
async def chat(req: dict):
    global DEFAULT_LANGUAGE, DEFAULT_VOICE_TYPE, DEFAULT_VOICE_SPEED
    user_id = "Ayush"  # temporary

    user_message = req.get("message", "").strip()
    language = req.get("language", "english")
    voice_type = req.get("voice_type", "female")
    voice_speed = req.get("voice_speed", "fast")
    
    # Store settings globally for background/tray ambient sessions
    DEFAULT_LANGUAGE = language
    DEFAULT_VOICE_TYPE = voice_type
    DEFAULT_VOICE_SPEED = voice_speed
    
    if not user_message:
        async def empty_stream():
            yield json.dumps({
                "type": "text",
                "data": "Please say something... I'm here and listening, but I need your input!"
            }) + "\n"
        return StreamingResponse(empty_stream(), media_type="application/x-ndjson")

    # FSM Operational Guard Check & Auto-Activation for Manual UI Input
    if fsm.state == STATE.CONFIRM:
        print("[AARYA/FSM] State transition override log: CONFIRM -> ACTIVE forced by chat")
        await fsm.confirm_played()
    elif fsm.state != STATE.ACTIVE:
        await fsm.confirm_played()

    print("Fetching memory...")
    history = get_chat_history(user_id)
    print("History length:", len(history))

    # 1. SAVE USER MESSAGE
    print("Saving message to Supabase...")
    save_message(user_id, "user", user_message)

    return StreamingResponse(
        chat_stream_generator(user_message, history, user_id),
        media_type="application/x-ndjson"
    )

@app.post("/api/vision")
async def vision_query(req: dict):
    user_id = "Ayush"
    prompt = req.get("prompt", "").strip()
    language = req.get("language") or "english"
    voice_speed = req.get("voice_speed") or "fast"
    
    user_query = prompt if prompt else "Analyze my screen and provide elite engineering context or debugging guidance based on what you see."
    print(f"[AARYA/Vision] Triggered Vision Scan! Query: '{user_query}'")
    
    # FSM Operational Guard Check & Auto-Activation for Manual UI Input
    if fsm.state != STATE.ACTIVE:
        await fsm.confirm_played()
    
    # Save user message to Supabase
    save_message(user_id, "user", f"[Vision Scan] {user_query}")
    
    encoded_image = None
    scan_path = None
    detailed_text = ""
    voice_summary = ""
    
    try:
        # 1. Capture fresh screenshot inside request scope with dynamic unique file naming (Cache-Busting)
        try:
            import os
            import uuid
            import time
            import glob
            from PIL import ImageGrab
            
            temp_filename = f"scan_{uuid.uuid4().hex}.png"
            scan_path = os.path.join(r"D:\Aarya", temp_filename)
            
            # Proactively clear out all old static image files from the workspace
            for old_img in glob.glob(r"D:\Aarya\scan_*.png") + glob.glob(r"D:\Aarya\scan_*.jpg") + [r"D:\Aarya\screenshot.png", r"D:\Aarya\last_scan.jpg"]:
                if os.path.exists(old_img) and old_img != scan_path:
                    try:
                        os.remove(old_img)
                    except Exception:
                        pass
            
            print("[VISION] Capturing fresh screenshot...")
            
            # Capture dynamic screenshot
            fresh_screenshot = ImageGrab.grab()
            fresh_screenshot.save(scan_path, "PNG")
            
            if not os.path.exists(scan_path):
                raise HTTPException(status_code=500, detail="Dynamic screenshot creation failed.")
                
            file_mtime = os.path.getmtime(scan_path)
            age_ms = (time.time() - file_mtime) * 1000
            print(f"[VISION] Dynamic screenshot saved to {scan_path} | Age: {age_ms:.2f}ms")
            
            with open(scan_path, "rb") as f:
                img_bytes = f.read()
                
            import base64
            encoded_image = base64.b64encode(img_bytes).decode("utf-8")
            print("[VISION] Fresh screenshot verified and encoded successfully.")
        except Exception as e:
            print(f"[ANTIGRAVITY VISION CRASH LOG]: Screenshot capture failed: {str(e)}")
            import traceback
            traceback.print_exc()
            raise HTTPException(status_code=500, detail=f"Screenshot capture failed: {e}")
            
        print("[VISION] Sending fresh frame to multimodal model")
        
        # 2. Check if Gemini is available via API key
        gemini_key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
        if gemini_key:
            print("[AARYA/Vision] Executing Vision with native Google GenAI SDK (Gemini)...")
            try:
                from google import genai
                from google.genai import types
                from pydantic import BaseModel, Field
                import base64
    
                class AaryaResponse(BaseModel):
                    screen: str = Field(description="Full Markdown documentation response. Use ## headings, ### subheadings, and - bullet points. Minimum 2 subheadings. Minimum 3 bullets per section. Exhaustive and structured.")
                    audio: str = Field(description="Exactly 3-4 sentence spoken summary. No markdown. Plain prose only. Sentence 1: direct answer. Sentence 2: key context. Sentence 3: implication or next step. Sentence 4 optional: follow-up invitation. High-energy, confident, peer-level tone.")
    
                client_local = genai.Client(api_key=gemini_key)
                
                image_part = types.Part.from_bytes(
                    data=base64.b64decode(encoded_image),
                    mime_type="image/png"
                )
                
                contents = [
                    types.Content(
                        role="user",
                        parts=[
                            types.Part.from_text(text=user_query),
                            image_part
                        ]
                    )
                ]
                
                response = client_local.models.generate_content(
                    model='gemini-2.5-flash',
                    contents=contents,
                    config=types.GenerateContentConfig(
                        system_instruction=VISION_SYSTEM_PROMPT,
                        temperature=0.4,
                        response_mime_type="application/json",
                        response_schema=AaryaResponse,
                        response_modalities=["TEXT"]
                    )
                )
    
                parsed = json.loads(response.text)
                detailed_text = parsed.get("screen") or parsed.get("detailed_text") or response.text
                voice_summary = parsed.get("audio") or parsed.get("voice_summary") or ""
                
            except Exception as e:
                print(f"[ANTIGRAVITY VISION CRASH LOG]: Native Gemini Vision failed: {str(e)}")
                import traceback
                traceback.print_exc()
                print(f"[AARYA/Vision] Native Gemini Vision failed: {e}. Falling back to Groq...")
                
        # 3. Fallback to Groq Vision (llama-3.2-11b-vision-preview)
        if not detailed_text:
            print("[AARYA/Vision] Executing Vision with Groq Llama-3.2-Vision...")
            if not GROQ_API_KEY:
                raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server.")
                
            headers = {
                "Authorization": f"Bearer {GROQ_API_KEY}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": "meta-llama/llama-4-scout-17b-16e-instruct",
                "messages": [
                    {
                        "role": "system",
                        "content": VISION_SYSTEM_PROMPT
                    },
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": user_query
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{encoded_image}"
                                }
                            }
                        ]
                    }
                ],
                "temperature": 0.4
            }
            
            try:
                def run_post():
                    return requests.post(GROQ_URL, headers=headers, json=payload, timeout=TIMEOUT)
                
                resp = await asyncio.to_thread(run_post)
                if resp.status_code != 200:
                    print(f"[AARYA/Vision] Groq Vision API error: {resp.text}")
                    raise HTTPException(status_code=502, detail=f"Groq Vision API returned {resp.status_code}")
                    
                raw_content = resp.json()["choices"][0]["message"]["content"]
                
                cleaned_content = raw_content.strip()
                match = re.search(r"(\{.*\})", cleaned_content, re.DOTALL)
                if match:
                    cleaned_content = match.group(1).strip()
                
                # Strip out control characters to prevent JSONDecodeError (e.g. invalid control character)
                cleaned_content = re.sub(r'[\x00-\x1F\x7F]', ' ', cleaned_content)
                
                parsed = json.loads(cleaned_content)
                detailed_text = parsed.get("screen") or parsed.get("detailed_text") or raw_content
                voice_summary = parsed.get("audio") or parsed.get("voice_summary") or ""
            except Exception as ge:
                print(f"[ANTIGRAVITY VISION CRASH LOG]: Groq Vision fallback failed: {str(ge)}")
                import traceback
                traceback.print_exc()
                raise HTTPException(status_code=500, detail=f"Vision model execution failed: {ge}")
    finally:
        # Guarantee cleanup of dynamic screenshot and delete image variables
        if 'fresh_screenshot' in locals() and fresh_screenshot:
            try:
                fresh_screenshot.close()
            except Exception:
                pass
            del fresh_screenshot
            
        if scan_path is not None and os.path.exists(scan_path):
            try:
                os.remove(scan_path)
                print(f"[VISION] Dynamic screenshot {scan_path} deleted from disk successfully.")
            except Exception as e:
                print(f"[VISION] Warning: Could not delete temp file: {e}")
                
        if encoded_image:
            del encoded_image
            
        gc.collect()
        print("[VISION] Memory and temporary files cleaned.")
        
    # 4. Enforce smart voice summary and save history
    voice_summary = enforce_smart_voice_summary(voice_summary, detailed_text)
    
    # Generate native audio bytes from Gemini
    audio_bytes = await generate_gemini_audio_with_fallback(voice_summary)
    base64_audio = base64.b64encode(audio_bytes).decode("utf-8") if audio_bytes else ""
    
    save_message(user_id, "assistant", detailed_text)
    
    print(f"[AARYA/Vision] Vision Scan SUCCESS: detailed_text ({len(detailed_text)} chars) | voice_summary: '{voice_summary[:60]}'")
    
    # 5. Notify Electron ambient response
    try:
        requests.post("http://127.0.0.1:3001/ambient-response", json={
            "query": f"[Vision Scan] {user_query}",
            "detailedText": detailed_text,
            "voiceSummary": voice_summary,
            "audio_bytes": base64_audio,
            "focus": True,
            "mood": "neutral"
        }, timeout=2.0)
    except Exception:
        pass
        
    return {
        "reply": {
            "detailed_text": detailed_text,
            "voice_summary": voice_summary,
            "audio_bytes": base64_audio,
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
async def transcribe_audio(
    audio: UploadFile = File(...),
    language: str = Form("english")
):
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

        # ── Send to Groq Whisper API with dynamic Indian hints ──
        lang_code = "en"
        prompt_guide = "English speech with a natural Indian accent, technical discussions about coding, web development."
        
        selected_lang = (language or "english").lower().strip()
        if selected_lang == "hindi":
            lang_code = "hi"
            prompt_guide = "casual conversational Hindi containing English technical terms like server, port, focus, database, API."
        elif selected_lang == "hinglish":
            lang_code = "hi"
            prompt_guide = "A casual conversation in conversational Hinglish, mixing Hindi and English words organically. Technical English words like server, crash, port binding, focus, next.js, electron, app, frontend, database, code should be spelled standardly in English."

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
                    "language": lang_code,
                    "prompt": prompt_guide,
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