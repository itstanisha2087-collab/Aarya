# scratch_run_all_v240_tests.py — AARYA Integration & Signal Processing Validator (v2.4.0)
import requests
import json
import time
import sys
import os
import numpy as np

# Set standard streams to UTF-8
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

BACKEND_BASE = "http://127.0.0.1:8000"

def test_fsm_lockout_and_watchdog():
    print("\n" + "="*60)
    print(" [TEST 1] FSM STATE-1 LOCKOUT & WATCHDOG TIMER")
    print("="*60)
    
    # Reset FSM
    requests.post(f"{BACKEND_BASE}/api/dismiss")
    time.sleep(0.5)
    
    # State should be DORMANT
    res = requests.get(f"{BACKEND_BASE}/api/v1/state")
    state = res.json()["current_state"]
    print(f"Initial FSM State (Expected 0 - DORMANT): {state}")
    assert state == 0, f"Expected DORMANT but got {state}"
    
    # Wake up FSM into STATE-1 (CONFIRM)
    print("Triggering /api/wake to enter CONFIRM...")
    res = requests.post(f"{BACKEND_BASE}/api/wake")
    data = res.json()
    print(f"Wake response status: {data.get('status')}")
    assert data.get("status") == "activated", "Failed to activate FSM"
    
    # Immediately check state
    res = requests.get(f"{BACKEND_BASE}/api/v1/state")
    state = res.json()["current_state"]
    print(f"State immediately after wake (Expected 1 - CONFIRM): {state}")
    assert state == 1, f"Expected CONFIRM but got {state}"
    
    # Attempt a query during State-1 (Should return 403 Forbidden!)
    print("Attempting to query /api/query while in CONFIRM state...")
    res = requests.post(f"{BACKEND_BASE}/api/query", json={"text": "hello aarya"})
    print(f"Query during CONFIRM status code: {res.status_code}")
    print(f"Query during CONFIRM response: {res.text}")
    assert res.status_code == 403, f"Expected 403 Forbidden but got {res.status_code}"
    print("[PASS] State-1 strictly rejected direct query with 403 Forbidden!")
    
    # Wait for the 2-second session safety watchdog to fire
    print("Sleeping 3.0 seconds to wait for FSM Watchdog timer...")
    time.sleep(3.0)
    
    # Verify auto-transition to ACTIVE (State 2)
    res = requests.get(f"{BACKEND_BASE}/api/v1/state")
    state = res.json()["current_state"]
    print(f"FSM State after watchdog timeout (Expected 2 - ACTIVE): {state}")
    assert state == 2, f"Expected ACTIVE but got {state}"
    print("[PASS] Watchdog successfully advanced FSM state to ACTIVE!")
    return True

def test_ndjson_frame_delivery():
    print("\n" + "="*60)
    print(" [TEST 2] NDJSON FRAME DELIVERY SEQUENCE & SCHEMA VALIDATION")
    print("="*60)
    
    # FSM is now in ACTIVE state. We can query directly.
    payload = {"text": "tell me a 1-sentence joke about AI."}
    print(f"Sending direct query: {payload}")
    
    res = requests.post(f"{BACKEND_BASE}/api/query", json=payload, stream=True, timeout=20.0)
    print(f"Connection Status Code (Expected 200): {res.status_code}")
    assert res.status_code == 200, f"Expected 200 but got {res.status_code}"
    
    print("Iterating over streaming NDJSON response frames...")
    expected_seq = 0
    received_types = set()
    done_frame_received = False
    
    for line in res.iter_lines():
        if line:
            decoded = line.decode('utf-8').strip()
            print(f"  Frame: {decoded[:120]}...")
            try:
                frame = json.loads(decoded)
            except Exception as e:
                print(f"FAIL: Not a valid JSON: {decoded}. Error: {e}")
                raise e
                
            # Assert schema keys
            assert "seq" in frame, f"Missing 'seq' in frame: {decoded}"
            assert "type" in frame, f"Missing 'type' in frame: {decoded}"
            assert "data" in frame, f"Missing 'data' in frame: {decoded}"
            
            # Assert monotonically incrementing sequence numbers
            actual_seq = frame["seq"]
            assert actual_seq == expected_seq, f"Sequence mismatch: expected {expected_seq} but got {actual_seq}"
            
            # Assert type
            ftype = frame["type"]
            assert ftype in ["text", "audio", "done", "error"], f"Invalid frame type: {ftype}"
            received_types.add(ftype)
            
            if ftype == "done":
                done_frame_received = True
                
            expected_seq += 1
            
    print(f"Received frame types: {received_types}")
    print(f"Final expected sequence number reached: {expected_seq}")
    assert done_frame_received, "Stream finished but never yielded 'done' frame type"
    print("[PASS] Stream framing strictly follows sequence-tagged NDJSON specifications!")
    return True

def test_vads_three_gates():
    print("\n" + "="*60)
    print(" [TEST 3] THREE-GATE AUDIO SIGNAL PROCESSING VALIDATION")
    print("="*60)
    
    sys.path.append(os.path.dirname(os.path.abspath(__file__)))
    from desktop_listener import AdaptiveNoiseFloor, WebRTCVADGate, compute_zcr
    
    # 1. Test Gate 1: Adaptive RMS Energy Floor and Gate 2: Vocal Peak Detector
    print("Simulating Gate 1 (RMS Floor) and Gate 2 (Vocal Peak)...")
    noise_floor = AdaptiveNoiseFloor(initial_floor=250.0, alpha=0.05, vocal_peak_multiplier=2.8)
    
    # Continuous ambient noise (low energy hum: RMS ~ 120)
    print("Simulating steady background fan noise (RMS 120)...")
    for _ in range(50):
        noise_floor.update(120.0)
        
    current_floor = noise_floor.noise_floor
    current_threshold = noise_floor.vocal_threshold
    print(f"  Steady Noise Floor adapted to: {current_floor:.1f}")
    print(f"  Vocal Peak Threshold adapted to: {current_threshold:.1f}")
    assert current_floor < 200.0, "Noise floor should adapt downwards towards steady noise"
    
    # Simulate a noisy keyboard tick or low breathing pop (RMS 250) - fails Gate 2
    rms_transient = 250.0
    is_vocal_transient = rms_transient > current_threshold
    print(f"  Transient tick (RMS: {rms_transient}): is_vocal={is_vocal_transient} (Expected: False)")
    assert not is_vocal_transient, "Transient tick should not trigger vocal peak threshold"
    
    # Simulate vocal onset (RMS 700) - passes Gate 2
    rms_vocal = 700.0
    is_vocal_speech = rms_vocal > current_threshold
    print(f"  Vocal speech onset (RMS: {rms_vocal}): is_vocal={is_vocal_speech} (Expected: True)")
    assert is_vocal_speech, "Vocal onset must trigger vocal peak threshold"
    
    # 2. Test Gate 3: WebRTC VAD / ZCR Fallback
    print("\nSimulating Gate 3 (Zero Crossing Rate Fallback for High Frequency Hiss)...")
    vad_gate = WebRTCVADGate(aggressiveness=2)
    
    # Simulate high frequency hiss (alternating signs e.g., + - + -) -> High ZCR
    hiss_samples = np.array([1000, -1000] * 240, dtype=np.int16)
    hiss_zcr = compute_zcr(hiss_samples)
    hiss_bytes = hiss_samples.tobytes()
    is_voiced_hiss = vad_gate.is_voiced(hiss_bytes, 16000)
    print(f"  High Frequency Hiss: ZCR={hiss_zcr:.3f} | is_voiced={is_voiced_hiss} (Expected: False)")
    assert not is_voiced_hiss, "Hiss must be rejected by VAD/ZCR classifier"
    
    # Simulate vowel frame (low frequency wave e.g., sinusoid) -> Low ZCR
    t = np.linspace(0, 0.03, 480)
    vowel_samples = (1000 * np.sin(2 * np.pi * 300 * t)).astype(np.int16)
    vowel_zcr = compute_zcr(vowel_samples)
    vowel_bytes = vowel_samples.tobytes()
    is_voiced_vowel = vad_gate.is_voiced(vowel_bytes, 16000)
    print(f"  Voiced Vowel Wave: ZCR={vowel_zcr:.3f} | is_voiced={is_voiced_vowel} (Expected: True)")
    # Since we are using ZCR fallback on Windows without webrtcvad, low ZCR (< 0.35) should evaluate to True!
    assert is_voiced_vowel, "Voiced wave must pass VAD/ZCR classifier"
    
    print("[PASS] Three-Gate Audio Pre-Recognizer pipeline verified successfully!")
    return True

def run_all_tests():
    try:
        test_fsm_lockout_and_watchdog()
        test_ndjson_frame_delivery()
        test_vads_three_gates()
        print("\n" + "="*60)
        print(" ALL v2.4.0 SYSTEM INTEGRATION TESTS EVALUATE TO: STRICT PASS")
        print("="*60)
    except AssertionError as e:
        print(f"\nTEST FAIL: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\nUNEXPECTED ERROR DURING TESTING: {e}")
        import traceback; traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    run_all_tests()
