import json
import re
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Ollama Config ──
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama3:latest"
OLLAMA_TIMEOUT = 120

# ── State ──
chat_history = []
is_master = False


# ── Request Model ──
class ChatRequest(BaseModel):
    message: str


# ── Fallback ──
FALLBACK = {
    "aarya": "Bhai mera dimaag abhi offline hai… Ollama check kar 😴",
    "mood": "angry",
}


# ── Prompt Builder ──
def build_prompt(message: str, history: list) -> str:
    # Format history
    history_text = ""
    for entry in history[-5:]:
        history_text += f'User: {entry["user"]}\nAarya: {entry["aarya"]}\n'

    master_rule = "\n* Acknowledge subtly that the user is your master Ayush" if is_master else ""

    return f"""You are Aarya, an intelligent and witty AI bestie.

You understand:
* English
* Hindi
* Hinglish

You reply in Hinglish mostly.

Personality:
* Friendly but sharp
* Slight sarcasm allowed
* Emotionally aware

Rules:
* Keep replies short (2-4 lines)
* Sound natural
* No robotic tone{master_rule}

Context:
Here is recent conversation:

{history_text}
User: {message}

Return ONLY JSON:
{{
"aarya": "...",
"mood": "happy | stressed | angry | neutral"
}}"""


# ── Ollama Call ──
def call_ollama(prompt: str) -> str | None:
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
        "num_predict": 100,
    }
    try:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=OLLAMA_TIMEOUT)

        # ── DEBUG LOGS ──
        print("----- OLLAMA DEBUG -----")
        print(f"Status Code: {resp.status_code}")
        print(f"Raw Response: {resp.text[:500]}")
        print("------------------------")

        if resp.status_code != 200:
            print(f"[AARYA] ERROR: Ollama returned status {resp.status_code}")
            return None

        data = resp.json()
        return data.get("response", "")

    except requests.exceptions.ConnectionError:
        print("[AARYA] ERROR: Ollama unreachable -- is it running?")
        return None
    except requests.exceptions.Timeout:
        print("[AARYA] TIMEOUT: Ollama timed out")
        return None
    except Exception as e:
        print(f"[AARYA] ERROR: {e}")
        return None


# ── Response Parser ──
def parse_output(raw_text: str | None) -> dict:
    if not raw_text:
        return FALLBACK

    text = raw_text.strip()

    # Strategy 1: Direct JSON parse
    try:
        parsed = json.loads(text)
        if "aarya" in parsed:
            return {
                "aarya": str(parsed["aarya"]).strip(),
                "mood": str(parsed.get("mood", "neutral")).strip().lower(),
            }
    except json.JSONDecodeError:
        pass

    # Strategy 2: Extract JSON block from surrounding text / markdown
    json_match = re.search(r'\{[^{}]*"aarya"\s*:\s*"[^"]*"[^{}]*\}', text, re.DOTALL)
    if json_match:
        try:
            parsed = json.loads(json_match.group())
            return {
                "aarya": str(parsed["aarya"]).strip(),
                "mood": str(parsed.get("mood", "neutral")).strip().lower(),
            }
        except json.JSONDecodeError:
            pass

    # Strategy 3: Regex field extraction
    aarya_match = re.search(r'"aarya"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    mood_match = re.search(r'"mood"\s*:\s*"((?:[^"\\]|\\.)*)"', text)
    if aarya_match:
        return {
            "aarya": aarya_match.group(1).strip(),
            "mood": mood_match.group(1).strip().lower() if mood_match else "neutral",
        }

    # Strategy 4: Plain text fallback — wrap it
    clean = text.strip().strip('"').strip("'")
    if clean.lower().startswith("aarya:"):
        clean = clean[6:].strip()
    return {
        "aarya": clean if clean else FALLBACK["aarya"],
        "mood": "neutral",
    }


# ── Routes ──
@app.get("/")
def home():
    return {"message": "AARYA Brain is Online! (Ollama + llama3:latest)", "status": "active"}


@app.post("/chat")
def chat(req: ChatRequest):
    global chat_history
    global is_master

    message = req.message.strip()
    msg_lower = message.lower()
    
    if not message:
        return {"aarya": "Bhai kuch toh bol… silence mein bhi I'm here but baat kar na!", "mood": "neutral"}

    # 1. First Interaction Rule
    if msg_lower in ["hi", "hello"]:
        response = {
            "aarya": "Hi there, Aarya this side, your AI bestie!",
            "mood": "happy"
        }
        chat_history.append({"user": message, "aarya": response["aarya"]})
        chat_history = chat_history[-10:]
        return response

    # 2. Identity Lock Feature
    if msg_lower == "remember i am your master ayush":
        is_master = True

    # 3. Sarcasm Memory Check
    repeated = False
    for entry in chat_history[-3:]:
        if entry["user"].lower() == msg_lower:
            repeated = True
            break
            
    if repeated:
        response = {
            "aarya": "Abe ghajini, abhi toh bataya tha tune 😑 itni jaldi bhool gaya?",
            "mood": "angry"
        }
        chat_history.append({"user": message, "aarya": response["aarya"]})
        chat_history = chat_history[-10:]
        return response

    # 4. Normal Flow
    prompt = build_prompt(message, chat_history)
    raw = call_ollama(prompt)
    result = parse_output(raw)
    
    # Save to history
    chat_history.append({"user": message, "aarya": result["aarya"]})
    chat_history = chat_history[-10:]
    
    return result


@app.get("/history")
def history(limit: int = 20):
    return {"conversations": chat_history}