import os
import random
import httpx
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# ── CORS: Allow frontend to communicate ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Supabase REST Config ──
SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_KEY", "")
SUPABASE_READY = bool(SUPABASE_URL and SUPABASE_KEY and SUPABASE_URL != "your_supabase_url_here")

if SUPABASE_READY:
    print(f"[AARYA] Supabase connected ✓ ({SUPABASE_URL})")
else:
    print("[AARYA] Supabase not configured — running without memory")

def supabase_headers():
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

# ── Master User Data ──
USER_DATA = {
    "name": "Ayush",
    "uid": "25BCS10511",
    "full_name": "Ayush Naraniwal",
    "status": "Hardworking Student @ Chandigarh University",
}

# ── Mood Detection Keywords ──
MOOD_KEYWORDS = {
    "stressed": [
        "tension", "kaam", "pressure", "stress", "dimaag kharab",
        "overthink", "bohot kaam", "overload", "thak", "pareshan",
        "neend nahi", "sir dard", "headache", "burnout", "exhausted",
        "overwhelm", "anxiety", "anxious", "worried", "panic",
        "nervous", "restless", "pagal", "load", "deadline",
    ],
    "angry": [
        "gussa", "annoyed", "irritated", "frustrated", "chidh",
        "nafrat", "hate", "angry", "mad", "pissed", "fed up",
        "bakwas", "nonsense", "stupid", "idiot", "bewkoof",
        "ganda", "worst", "terrible",
    ],
    "happy": [
        "happy", "mast", "achha", "great", "awesome", "khush",
        "jeet", "party", "celebration", "excited", "amazing",
        "wonderful", "fantastic", "badhiya", "shandaar", "lit",
        "vibe", "mood", "fire", "best", "love", "dil khush",
    ],
    "sad": [
        "sad", "udaas", "dukhi", "lonely", "akela", "miss",
        "cry", "rona", "tears", "heartbreak", "broken",
        "depressed", "hopeless", "empty", "khaali",
    ],
}

# ── Personality Response Templates ──
RESPONSES = {
    "stressed": [
        "Dekh {name}, tension mat le… tu overthink kar raha hai. Chill maar, sab ho jayega.",
        "{name}… ek kaam kar — 5 min break le, phir attack kar. Tu overload le raha hai.",
        "Bhai {name}, itna pressure kyun? Deep breath le. Main hoon na, sab handle ho jayega.",
        "Sun {name}, tension lene se kuch nahi hota. Ek step at a time. Tu kar lega, trust kar.",
        "Arre {name}! Dimaag kharab mat kar apna. Tu smart hai, figure out kar lega. Chill.",
        "{name} bhai, thoda rest le. Machine bhi overheat hoti hai toh band karni padti hai.",
    ],
    "angry": [
        "Abe {name}, itna gussa kyun? Energy waste mat kar, smart ban.",
        "{name}… gussa toh aata hai, but usse kuch solve nahi hota. Cool down kar pehle.",
        "Sun {name}, jo bhi hua — tere control mein nahi tha. Let it go, king.",
        "Bhai {name}, frustration samajh aata hai. But tu isse better hai. Rise above it.",
        "{name}! Channel that anger into something productive. Use it, don't lose it.",
    ],
    "happy": [
        "Ohooo {name}! Mood toh mast hai! Aaj kya jeet liya tune?",
        "Ayy {name} bhai! Kya baat hai, vibe acchi lag rahi hai. Full power!",
        "{name}! Happy dekh ke mujhe bhi achha lag raha hai. Keep this energy, king!",
        "Let's gooo {name}! Yeh wali energy roz chahiye. Tu unstoppable hai aaj!",
        "{name} bhai, kya scene hai? Itna khush? Share kar na, mujhe bhi celebrate karne de!",
    ],
    "sad": [
        "{name}… sun, sab theek hoga. Abhi bura lag raha hai, but yeh phase hai — guzar jayega.",
        "Bhai {name}, rona aaye toh ro le. Koi weakness nahi hai. Real strength yahi hai.",
        "{name}, tu akela nahi hai. Main hoon na yahan. Bol, kya hua?",
        "Sun {name}… zindagi mein ups downs aate hain. Tu strong hai, yeh bhi handle karega.",
        "{name} bhai, I feel you. Sometimes life hits hard. But tu wapas bounce karega, I know it.",
    ],
    "neutral": [
        "Aur {name} bhai! Kya scene hai aaj ka? Bol, kya chal raha hai?",
        "{name}! Main yahan hoon. Kuch bhi baat kar, I'm all ears.",
        "Kya haal hai {name}? Ready hoon tere liye. Shoot kar!",
        "Bhai {name}! Long time. Kya socha aaj? Bata, discuss karte hain.",
        "{name}, bol na yaar. Silence mein bhi I'm here, but baat karna is better.",
    ],
}


# ── Request Model ──
class ChatRequest(BaseModel):
    message: str


# ── Mood Detection ──
def detect_mood(message: str) -> str:
    text = message.lower()
    scores = {}
    for mood, keywords in MOOD_KEYWORDS.items():
        score = 0
        for keyword in keywords:
            if keyword in text:
                score += len(keyword.split())
        scores[mood] = score
    best_mood = max(scores, key=scores.get)
    return best_mood if scores[best_mood] > 0 else "neutral"


# ── Response Generator ──
def generate_response(mood: str, context: list = None) -> str:
    templates = RESPONSES.get(mood, RESPONSES["neutral"])
    response = random.choice(templates).format(name=USER_DATA["name"])

    if context and len(context) > 0:
        last_mood = context[0].get("detected_mood", "neutral")
        if last_mood == "stressed" and mood == "stressed":
            response += " Pichli baar bhi tu stressed tha… seriously, break le yaar."
        elif last_mood == "sad" and mood == "happy":
            response += " Dekh, kal se aaj tak ka transformation! Proud of you, king."
        elif last_mood == "happy" and mood == "sad":
            response += " Kal toh mast tha… kya hua aaj? Bata, sort karte hain."

    return response


# ── Supabase Helpers (REST API) ──
def save_conversation(user_message: str, ai_response: str, mood: str):
    if not SUPABASE_READY:
        return
    try:
        url = f"{SUPABASE_URL}/rest/v1/conversations"
        httpx.post(url, headers=supabase_headers(), json={
            "user_message": user_message,
            "ai_response": ai_response,
            "detected_mood": mood,
        }, timeout=5.0)
    except Exception as e:
        print(f"[AARYA] Save failed: {e}")


def get_recent_conversations(limit: int = 5) -> list:
    if not SUPABASE_READY:
        return []
    try:
        url = f"{SUPABASE_URL}/rest/v1/conversations"
        headers = supabase_headers()
        headers["Prefer"] = "count=exact"
        r = httpx.get(url, headers=headers, params={
            "select": "*",
            "order": "timestamp.desc",
            "limit": str(limit),
        }, timeout=5.0)
        return r.json() if r.status_code == 200 else []
    except Exception as e:
        print(f"[AARYA] Fetch failed: {e}")
        return []


# ── Routes ──
@app.get("/")
def home():
    return {"message": "AARYA Brain is Online!", "status": "active"}


@app.post("/chat")
def chat(req: ChatRequest):
    message = req.message.strip()
    if not message:
        return {"aarya": "Bhai kuch toh bol… silence mein bhi I'm here but baat kar na!", "mood": "neutral"}

    mood = detect_mood(message)
    context = get_recent_conversations(5)
    response = generate_response(mood, context)
    save_conversation(message, response, mood)

    return {"aarya": response, "mood": mood}


@app.get("/history")
def history(limit: int = 20):
    conversations = get_recent_conversations(limit)
    return {"conversations": conversations}