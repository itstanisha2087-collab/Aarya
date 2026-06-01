import requests
import json
import time

def test_ambient_query(name, query):
    print(f"\n==================================================")
    print(f" RUNNING TEST: {name}")
    print(f" Spoken Input: \"{query}\"")
    print(f"==================================================")
    
    url = "http://127.0.0.1:8000/api/ambient-query"
    payload = {
        "query": query,
        "source": "ambient_listener",
        "mode": "jarvis_single_pass",
        "language": "english",
        "voice_speed": "fast"
    }
    
    try:
        start_time = time.time()
        res = requests.post(url, json=payload, timeout=30.0)
        duration = time.time() - start_time
        
        if res.status_code != 200:
            print(f"FAIL: Server returned status {res.status_code}")
            return False
            
        data = res.json()
        print(f"Success! Request completed in {duration:.2f}s.")
        
        detailed_text = data.get("detailed_text", "")
        voice_summary = data.get("voice_summary", "")
        
        print("\nGenerated High-Caliber Deep Response (detailed_text):")
        print("-" * 50)
        print(detailed_text)
        print("-" * 50)
        
        print("\nConversational Spoken Response (voice_summary):")
        print("-" * 50)
        print(voice_summary)
        print("-" * 50)
            
        return True
    except Exception as e:
        print(f"FAIL: Request failed with exception: {e}")
        return False

def main():
    print("Initializing AARYA High-Caliber Conversational Intelligence Verification...")
    time.sleep(2.0)  # Wait for backend Supabase connection block to complete
    
    # TEST 1: Technical query (Should output elite deep technical breakdown)
    test_ambient_query("TEST 1: Electron + Next.js Race Conditions (Technical)", "explain why Electron and Next.js race conditions happen.")
    print("Waiting 15 seconds for Groq TPM rate limits to decay...")
    time.sleep(15.0)
    
    # TEST 2: Real-time query — News/World events (Should trigger web search and respond naturally without templates)
    test_ambient_query("TEST 2: Current World Events (Real-time)", "What is happening in the world right now?")
    print("Waiting 15 seconds for Groq TPM rate limits to decay...")
    time.sleep(15.0)
    
    # TEST 3: Real-time query — AI Updates (Should trigger web search and describe AI breakthroughs in a chill Hinglish tone)
    test_ambient_query("TEST 3: AI Updates (Real-time)", "What's new in AI?")
    print("Waiting 15 seconds for Groq TPM rate limits to decay...")
    time.sleep(15.0)
    
    # TEST 4: Casual Query (Should reply warmly in a chill bestie tone, no search required)
    test_ambient_query("TEST 4: Conversational / Warm Prompt", "Hello Aarya tell me something interesting")
    print("Waiting 15 seconds for Groq TPM rate limits to decay...")
    time.sleep(15.0)

    # TEST 5: Real-time query — Tech updates (Should trigger search and summarize naturally)
    test_ambient_query("TEST 5: Tech Updates (Real-time)", "Summarize current tech updates")

if __name__ == "__main__":
    main()


