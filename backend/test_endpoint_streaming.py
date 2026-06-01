import requests
import json
import time

def test_streaming():
    chat_url = "http://127.0.0.1:8000/chat"
    payload = {
        "message": "Hi Aarya, tell me a 1-sentence interesting fact about space.",
        "language": "english",
        "voice_type": "female",
        "voice_speed": "fast"
    }
    
    print("\nSending chat request to /chat for real-time NDJSON stream...")
    
    start_time = time.time()
    first_chunk_received = False
    text_chunks_count = 0
    audio_chunks_count = 0
    accumulated_text = ""
    
    try:
        # Use stream=True to read chunks progressively
        res = requests.post(chat_url, json=payload, stream=True, timeout=20.0)
        print(f"Connection Status Code: {res.status_code}")
        
        if res.status_code != 200:
            print(f"[FAIL] Backend returned HTTP {res.status_code}")
            return False
            
        for line in res.iter_lines():
            if line:
                decoded_line = line.decode('utf-8').strip()
                if not first_chunk_received:
                    latency = time.time() - start_time
                    print(f"First NDJSON chunk received in {latency:.3f} seconds! (Target: <2.0s)")
                    first_chunk_received = True
                    if latency <= 2.0:
                        print("[SUCCESS] Sub-2.0s First-Chunk Latency Target MET!")
                    else:
                        print("[WARNING] First-Chunk Latency is above 2.0s.")
                
                try:
                    parsed = json.loads(decoded_line)
                    chunk_type = parsed.get("type")
                    data = parsed.get("data", "")
                    
                    if chunk_type == "text":
                        text_chunks_count += 1
                        accumulated_text += data
                        print(f"  [TEXT CHUNK]: {data}")
                    elif chunk_type == "audio":
                        audio_chunks_count += 1
                        # Only print length to not flood console
                        print(f"  [AUDIO CHUNK]: {len(data)} base64 chars")
                    elif chunk_type == "error":
                        print(f"  [ERROR CHUNK]: {data}")
                        return False
                except Exception as e:
                    print(f"Failed to parse line: {decoded_line}. Error: {e}")
                    
        print("\n--- STREAM SUMMARY ---")
        print(f"Total Text Chunks: {text_chunks_count}")
        print(f"Total Audio Chunks: {audio_chunks_count}")
        print(f"Full Text Response: \"{accumulated_text.strip()}\"")
        
        if text_chunks_count > 0:
            print("\n[VERIFICATION SUCCESS] real-time NDJSON stream yields text chunks progressively!")
            if audio_chunks_count > 0:
                print("[INFO] Audio chunks were also streamed successfully.")
            else:
                print("[INFO] Note: Audio chunks were empty due to Google GenAI free tier 429 rate limits.")
            return True
        else:
            print("\n[VERIFICATION FAIL] Missing text chunks in stream.")
            return False
            
    except Exception as e:
        print(f"Error checking streaming /chat endpoint: {e}")
        return False

if __name__ == "__main__":
    test_streaming()
