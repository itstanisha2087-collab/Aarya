import requests
import time

def test_endpoint():
    url = "http://127.0.0.1:8000/api/vision"
    payload = {
        "prompt": "Analyze my screen and confirm if you can see a code window.",
        "language": "english",
        "voice_speed": "fast"
    }
    
    print("\nSending visual scan request to /api/vision...")
    start_time = time.time()
    
    try:
        res = requests.post(url, json=payload, timeout=25.0)
        latency = time.time() - start_time
        print(f"Status Code: {res.status_code}")
        print(f"Total Request Duration: {latency:.2f} seconds")
        
        if res.status_code == 200:
            data = res.json()
            reply = data.get("reply", {})
            detailed_text = reply.get("detailed_text")
            voice_summary = reply.get("voice_summary")
            
            print("\n--- ENDPOINT VERIFICATION SUCCESS ---")
            print(f"UI Text Length: {len(detailed_text) if detailed_text else 0} characters")
            print(f"Voice Summary: \"{voice_summary}\"")
            print("[SUCCESS] FastAPI /api/vision returned 200 OK and successfully parsed visual insights!")
            return True
        else:
            print(f"[FAIL] HTTP Status {res.status_code}, error: {res.text}")
            return False
    except Exception as e:
        print(f"[FAIL] Connection error: {e}")
        return False

if __name__ == "__main__":
    test_endpoint()
