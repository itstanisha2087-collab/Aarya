import os
import re
import json
import base64
import requests
from dotenv import load_dotenv
from PIL import ImageGrab
import io

# Load .env
backend_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(dotenv_path=os.path.join(backend_dir, ".env"))

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
print(f"GROQ_API_KEY: {GROQ_API_KEY[:10] if GROQ_API_KEY else 'None'}...")

VISION_SYSTEM_PROMPT = """You are AARYA, the elite personal engineering AI partner. Analyze the screen and provide insights in JSON format with exactly two keys:
1. "screen": Analysis in rich markdown.
2. "audio": A standalone 3-to-4 sentence spoken summary without markdown.
"""

def test_groq_vision():
    if not GROQ_API_KEY:
        print("[FAIL] GROQ_API_KEY not configured.")
        return False
        
    print("Capturing test screenshot...")
    screenshot = ImageGrab.grab()
    img_buffer = io.BytesIO()
    screenshot.save(img_buffer, format="PNG")
    img_bytes = img_buffer.getvalue()
    encoded_image = base64.b64encode(img_bytes).decode("utf-8")
    
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
                        "text": "Analyze my screen and tell me what is open."
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
    
    print("Sending visual frame to Groq Llama-3.2-Vision...")
    try:
        resp = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=20.0)
        print(f"Groq Response Status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"[FAIL] Groq returned error: {resp.text}")
            return False
            
        raw_content = resp.json()["choices"][0]["message"]["content"]
        print(f"Raw Output: {raw_content[:200]}...")
        
        # Resilient parsing
        cleaned_content = raw_content.strip()
        match = re.search(r"(\{.*\})", cleaned_content, re.DOTALL)
        if match:
            cleaned_content = match.group(1).strip()
            
        # Strip out control characters
        cleaned_content = re.sub(r'[\x00-\x1F\x7F]', ' ', cleaned_content)
        
        parsed = json.loads(cleaned_content)
        detailed_text = parsed.get("screen")
        voice_summary = parsed.get("audio")
        
        print("\n--- VISION PARSE SUCCESS ---")
        print(f"Screen text length: {len(detailed_text) if detailed_text else 0}")
        print(f"Voice summary: {voice_summary}")
        if detailed_text and voice_summary:
            print("[SUCCESS] Groq Vision Fallback is 100% operational!")
            return True
            
    except Exception as e:
        print(f"[FAIL] Execution crashed: {e}")
        import traceback
        traceback.print_exc()
        
    return False

if __name__ == "__main__":
    test_groq_vision()
