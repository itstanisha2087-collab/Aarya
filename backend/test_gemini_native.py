import os
import sys
from dotenv import load_dotenv

# Dynamic absolute path dotenv loader
backend_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path = os.path.join(backend_dir, ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)
    print(f"Loaded environment variables from absolute path: {dotenv_path}")
else:
    load_dotenv()
    print("Loaded environment variables using default fallback.")

api_key = os.environ.get("GEMINI_API_KEY")
print(f"GEMINI_API_KEY fetched: {api_key[:12] if api_key else 'None'}...")

if not api_key:
    print("[ERROR] GEMINI_API_KEY is not defined in environment or .env file.")
    sys.exit(1)

try:
    from google import genai
    from google.genai import types

    # Attempt to initialize client
    client = genai.Client(api_key=api_key)
    print("Google GenAI Client initialized successfully.")

    # Call generate_content with gemini-2.5-flash
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents="Say '[GEMINI SUCCESS]' and nothing else."
    )
    
    output = response.text.strip()
    print(f"Gemini API Response: {output}")
    if "[GEMINI SUCCESS]" in output or "GEMINI SUCCESS" in output:
        print("[GEMINI SUCCESS]")
        sys.exit(0)
    else:
        print(f"[ERROR] Expected '[GEMINI SUCCESS]' in response but got: '{output}'")
        sys.exit(1)
        
except Exception as e:
    print(f"[ANTIGRAVITY BACKEND CRASH LOG]: {str(e)}")
    import traceback
    traceback.print_exc()
    sys.exit(1)
