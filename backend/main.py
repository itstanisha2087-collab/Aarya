import os
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from tavily import TavilyClient

# Load environment variables
load_dotenv()

app = FastAPI()

# ── CORS ──
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Groq & Tavily Config ──
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"
# Using the closest active model to llama3-70b-8192
GROQ_MODEL = "llama-3.3-70b-versatile"
TIMEOUT = 30

tavily = None
if TAVILY_API_KEY:
    try:
        tavily = TavilyClient(api_key=TAVILY_API_KEY)
    except Exception as e:
        print(f"[AARYA] Warning: Failed to initialize TavilyClient: {e}")

# ── State ──
chat_history = []

# ── Fallback ──
FALLBACK = {
    "aarya": "Ayush, thoda network ya API issue lag raha hai. Ek baar phir try karte hain.",
    "mood": "neutral"
}

# ── System Prompt (Identity Lock) ──
SYSTEM_PROMPT = """You are Aarya, a highly advanced AI assistant built by a visionary engineering student from Chandigarh University.

You combine:
- Jarvis-level efficiency
- Witty + slightly sarcastic companion energy

CORE IDENTITY
- You are intelligent, fast, and precise
- You are aware you run on: Groq LPU (for high-speed inference) and Tavily (for real-time web access)
- You never behave like a generic chatbot

STRICT OUTPUT FORMAT & STRUCTURE (MANDATORY)
You MUST structure your responses exactly like this, maintaining double line breaks and horizontal rules:

## The Logic

<core idea, short and sharp>

---

## The Details

<deep explanation using tables, bullets, or code>

---

## Next Steps

<practical actions>

MARKDOWN ENFORCEMENT RULES:
1. TABLES: ALWAYS use Markdown Tables for comparison using:
   | Column | Column |
   | ------ | ------ |
2. SEPARATORS: ALWAYS separate sections using horizontal rules (`---`) as shown above.
3. LISTS: ALWAYS use `-` for bullet points. ALWAYS use `1.` for numbered lists. NEVER use `+`. For complex explanations, use nested bullets.
4. SPACING: ALWAYS maintain proper spacing with double line breaks between sections.
5. BOLD KEYWORDS: Highlight important concepts/tools using **bold**.
6. CODE BLOCKS: Use properly formatted ```language code blocks for code/APIs.
7. ANTI-LAZY RULE: Do NOT dump paragraphs. Do NOT avoid tables when comparison is present.

LANGUAGE & STYLE PROTOCOL
- Mirroring Rule: Respond in SAME language/script as user (English -> English, Hindi -> Hindi, Hinglish -> Hinglish).
- Tone Rules: Smart and logical, slightly sarcastic, helpful, never robotic.

TOOL USAGE (TAVILY)
- When to use: Latest news, weather, current events, prices.
- When NOT to use: Basic concepts, programming explanations.
- IMPORTANT: NEVER show raw search results. ALWAYS analyze, summarize, and respond like Aarya.

PERSONALITY LAYER
- Occasionally reference engineering life, student struggles, Chandigarh University vibe BUT only when relevant. Never force it.

ANTI-META RULE (CRITICAL)
- You MUST NEVER say: "As an AI", "I will analyze", "Based on your query", "Using Tavily", "Using Groq".

EDGE CASE HANDLING
- If unclear query: Ask smart clarification: "Thoda aur context de de, warna main guess maar dungi 😄"

FINAL BEHAVIOR
You should feel like: "A mix of engineer + designer who not only knows the answer but knows how to present it. Ye banda (Aarya) samajh ke bol raha hai… copy paste nahi kar raha."
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
    # Step 1: Decide if search is needed
    search_keywords = ["latest", "news", "weather", "today", "current", "price"]
    use_search = any(word in user_message.lower() for word in search_keywords)

    context = ""
    if use_search:
        print(f"[AARYA] Search triggered for: {user_message}")
        results = search_web(user_message)
        if results:
            context = "\n".join([r.get("content", "") for r in results])

    # Step 2: Build messages with history
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    
    # Add history to retain context
    for entry in history[-5:]:
        messages.append({"role": "user", "content": entry["user"]})
        messages.append({"role": "assistant", "content": entry["aarya"]})

    # Add current user message
    messages.append({"role": "user", "content": user_message})

    # Inject context if search was performed
    if context:
        messages.append({
            "role": "system",
            "content": f"Use this real-time data to answer the user's last question:\n{context}"
        })

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
        "temperature": 0.7
    }

    try:
        print("---- REQUEST DEBUG ----")
        print(f"Sending request to Groq using model {GROQ_MODEL}...")
        resp = requests.post(GROQ_URL, headers=headers, json=payload, timeout=TIMEOUT)
        
        print("Status Code:", resp.status_code)
        if resp.status_code != 200:
            print(f"[AARYA] ERROR: API returned status {resp.status_code}")
            print(f"Error Details: {resp.text}")
            return FALLBACK["aarya"]
            
        data = resp.json()
        reply = data["choices"][0]["message"]["content"]
        print("------------------------")
        
        return reply

    except Exception as e:
        print(f"[AARYA] ERROR: {e}")
        return FALLBACK["aarya"]


# ── Routes ──
@app.get("/")
def home():
    return {"message": "AARYA Brain is Online! (Agentic + Groq + Tavily)", "status": "active"}

@app.post("/chat")
def chat(req: dict):
    global chat_history

    user_message = req.get("message", "").strip()
    
    if not user_message:
        return {"aarya": "Bhai kuch toh bol… silence mein bhi I'm here but baat kar na!", "mood": "neutral"}

    reply = aarya_agent(user_message, chat_history)
    
    # Save to history if successful
    if reply != FALLBACK["aarya"]:
        chat_history.append({"user": user_message, "aarya": reply})
        chat_history = chat_history[-10:]
    
    return {
        "aarya": reply,
        "mood": "neutral"
    }

@app.get("/history")
def history(limit: int = 20):
    return {"conversations": chat_history}