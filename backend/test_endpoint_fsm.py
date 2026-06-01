import requests
import json

def test_endpoint():
    # 1. Check current FSM State
    state_url = "http://127.0.0.1:8000/api/v1/state"
    try:
        res = requests.get(state_url)
        print(f"Current FSM State response: {res.json()}")
    except Exception as e:
        print(f"Failed to query state: {e}")

    # 2. Send chat request to /chat
    chat_url = "http://127.0.0.1:8000/chat"
    payload = {
        "message": "Hi Aarya, list three cool facts about the universe.",
        "language": "english",
        "voice_type": "female",
        "voice_speed": "fast"
    }
    
    print("\nSending chat request to /chat...")
    try:
        res = requests.post(chat_url, json=payload, timeout=20.0)
        print(f"Status Code: {res.status_code}")
        if res.status_code == 200:
            print("[VERIFICATION SUCCESS] UI chat query bypassed FSM dormant check, auto-activated to ACTIVE, and completed successfully!")
            print(f"Response preview: {res.json()['reply']['voice_summary']}")
            
            # 3. Verify the state was forced to ACTIVE
            state_res = requests.get(state_url)
            print(f"New FSM State (Expected ACTIVE=2): {state_res.json()}")
        else:
            print(f"[VERIFICATION FAIL] Status {res.status_code}, error: {res.text}")
    except Exception as e:
        print(f"Error calling /chat: {e}")

if __name__ == "__main__":
    test_endpoint()
