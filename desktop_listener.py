import os
import sys
import time
import requests
import winsound
import speech_recognition as sr
import threading

# Set standard streams to UTF-8 to prevent encoding crashes on Windows
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

print("==================================================")
print("      AARYA Ambient Voice Listener Active         ")
print("==================================================")
print("Running inside an active desktop session with direct mic access.")

BACKEND_AMBIENT_URL = "http://127.0.0.1:8000/api/ambient-query"
LOG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "listener_debug.log")


def log(msg):
    """Print and append to debug log file."""
    timestamp = time.strftime("%H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def play_chime():
    """Play a premium rising chime on wake detection."""
    try:
        winsound.Beep(880, 100)
        winsound.Beep(1100, 150)
    except Exception as e:
        log(f"[AARYA/Listener] Beep synthesis failed: {e}")


def play_confirm_chime():
    """Play a premium high double beep to confirm active query capture."""
    try:
        winsound.Beep(1100, 80)
        winsound.Beep(1320, 120)
    except Exception as e:
        log(f"[AARYA/Listener] Beep synthesis failed: {e}")


def trigger_electron_wake():
    """Send an instant, zero-latency wake signal directly to local Electron IPC server."""
    try:
        # Hits Electron's local Node HTTP server wake endpoint instantly
        requests.post("http://127.0.0.1:3001/wake", json={}, timeout=1.0)
        log("[AARYA/Listener] Sent instant direct Electron wake IPC signal.")
    except Exception as e:
        log(f"[AARYA/Listener] Instant wake signal failed: {e}")


def send_ambient_query(query):
    """Send ambient voice query payload silently to FastAPI backend as a single-pass execution."""
    log(f"[AARYA/Listener] Dispatched Jarvis single-pass query: '{query}'")
    
    # Play a quick confirmation chime if it is NOT a stop command
    is_stop = any(trigger in query.lower() for trigger in ["stop", "cancel", "quiet", "silence", "shh"])
    if not is_stop:
        play_confirm_chime()

    try:
        payload = {
            "query": query,
            "source": "ambient_listener",
            "mode": "jarvis_single_pass",
            "language": "english"
        }
        res = requests.post(BACKEND_AMBIENT_URL, json=payload, timeout=20.0)
        if res.status_code == 200:
            log(f"[AARYA/Listener] Single-pass query SUCCESS: {res.json()}")
            print("[INFO] Query payload sent successfully.", flush=True)
        else:
            log(f"[AARYA/Listener] Query returned status: {res.status_code}")
    except Exception as e:
        log(f"[AARYA/Listener] Query connection failed: {e}")


def send_ambient_query_async(query):
    """Spawn background thread to dispatch query payload and prevent mic queue block."""
    threading.Thread(target=send_ambient_query, args=(query,), daemon=True).start()


def parse_ambient_command(text):
    """
    Parses the transcribed text for a trigger word anywhere in the sentence and extracts
    the true query. Strips single-word greetings and merges prefix + suffix surrounding the trigger.
    Returns (matched: bool, query: str)
    """
    text_clean = text.lower().strip()
    
    # Trigger names to look for
    triggers = ["aarya", "arya", "aria", "ariya", "aariya"]
    
    matched_trigger = None
    trigger_index = -1
    
    # Find the earliest trigger word in the sentence
    for trig in triggers:
        idx = text_clean.find(trig)
        if idx != -1:
            if trigger_index == -1 or idx < trigger_index:
                trigger_index = idx
                matched_trigger = trig
                
    if matched_trigger is None:
        return False, ""

    # Extract prefix and suffix surrounding the trigger
    prefix = text_clean[:trigger_index].strip()
    suffix = text_clean[trigger_index + len(matched_trigger):].strip()
    query = f"{prefix} {suffix}".strip()
    
    # Strip leading/trailing punctuation
    query = query.strip(",.:;!? ")
    
    # Split into words to clean up leading greeting fluff
    words = query.split()
    if not words:
        return True, "hello"  # Default to warm greeting if they only said "Aarya"
        
    greetings = {"hello", "hey", "hi", "wake", "up", "suno", "please", "yo", "oi"}
    while words and words[0].strip(",.:;!? ") in greetings:
        words.pop(0)
        
    query_clean = " ".join(words).strip(",.:;!? ")
    
    if not query_clean:
        return True, "hello"
        
    return True, query_clean


# ── Audio capture constants (PRD Section 5.2.1) ──────────────────────
CHUNK_SIZE               = 1024        # Smaller chunks = faster energy sampling
SAMPLE_RATE              = 16000       # 16kHz — optimal for speech recognition
PHRASE_TIME_LIMIT        = 15.0        # Maximum phrase capture window

# ── SpeechRecognition energy threshold tuning ─────────────────────────
ENERGY_THRESHOLD_FLOOR   = 150    # Never go below this (prevents noise triggers)
ENERGY_THRESHOLD_DEFAULT = 250    # Initial value before dynamic calibration
DYNAMIC_ENERGY_RATIO     = 1.3    # Multiplier above ambient for voice detection
DYNAMIC_ENERGY_ENABLED   = True   # Always on; adapts to room conditions

def build_recognizer() -> sr.Recognizer:
    recognizer = sr.Recognizer()

    # Sensitivity settings
    recognizer.energy_threshold         = ENERGY_THRESHOLD_DEFAULT
    recognizer.dynamic_energy_threshold = DYNAMIC_ENERGY_ENABLED
    recognizer.dynamic_energy_adjustment_damping  = 0.15
    recognizer.dynamic_energy_ratio     = DYNAMIC_ENERGY_RATIO

    # Pause and phrase timing
    recognizer.pause_threshold          = 0.6   # Seconds of silence = phrase end
    recognizer.phrase_threshold         = 0.3   # Min phrase duration to capture
    recognizer.non_speaking_duration    = 0.4   # Pre-phrase silence buffer

    return recognizer

def calibrate_microphone(recognizer: sr.Recognizer, duration: float = 2.0):
    """
    Samples ambient noise for `duration` seconds on startup.
    Sets a dynamic baseline so threshold self-adjusts to room conditions.
    Must be called once before the main listen loop.
    """
    with sr.Microphone(sample_rate=SAMPLE_RATE, chunk_size=CHUNK_SIZE) as source:
        log("[AARYA Listener] Calibrating microphone to ambient noise...")
        recognizer.adjust_for_ambient_noise(source, duration=duration)
        # Enforce floor to prevent over-sensitivity in very quiet rooms
        if recognizer.energy_threshold < ENERGY_THRESHOLD_FLOOR:
            recognizer.energy_threshold = ENERGY_THRESHOLD_FLOOR
        log(f"[AARYA Listener] Energy threshold set to: {recognizer.energy_threshold:.1f}")

def listening_loop():
    log("[AARYA/Listener] Initializing tuned SpeechRecognition engine...")
    r = build_recognizer()
    
    # 1. Calibrate to room ambient noise floor on startup (PRD Section 5.2.2)
    calibrate_microphone(r, duration=2.0)
    
    log("[AARYA/Listener] Starting always-on background listening loop...")
    while True:
        try:
            # Initialize microphone once and hold it open permanently
            with sr.Microphone(sample_rate=SAMPLE_RATE, chunk_size=CHUNK_SIZE) as source:
                log("[INFO] Microphone stream opened and PERMANENTLY ON at OS level.")
                
                while True:
                    try:
                        # ── Prevent Mic Self-Feedback (Before Recording) ──
                        try:
                            check_res = requests.get("http://127.0.0.1:8000/api/playback-state", timeout=0.8)
                            if check_res.status_code == 200 and check_res.json().get("is_speaking", False):
                                time.sleep(0.2)
                                continue
                        except Exception:
                            pass # If backend is offline, continue listening normally

                        audio = r.listen(source, timeout=10, phrase_time_limit=PHRASE_TIME_LIMIT)
                    except sr.WaitTimeoutError:
                        continue
                    
                    try:
                        # ── Prevent Mic Self-Feedback (After Recording, before transcribing) ──
                        try:
                            check_res = requests.get("http://127.0.0.1:8000/api/playback-state", timeout=0.8)
                            if check_res.status_code == 200 and check_res.json().get("is_speaking", False):
                                log("[AARYA/Listener] Speech playback active during capture. Ignoring.")
                                time.sleep(0.2)
                                continue
                        except Exception:
                            pass

                        text = r.recognize_google(audio).lower().strip()
                        log(f"[AARYA/Listener] Heard: \"{text}\"")

                        matched, query = parse_ambient_command(text)
                        if matched:
                            log(f"[AARYA/Listener] Wake-word matched! Extracting query: '{query}'")
                            
                            # Trigger instant foregrounding in background thread
                            threading.Thread(target=trigger_electron_wake, daemon=True).start()
                            
                            # Dispatch query async to backend
                            send_ambient_query_async(query)
                            
                            # Sleep to let backend register is_speaking before listening again
                            time.sleep(0.5)
                            continue
                        else:
                            log(f"[AARYA/Listener] (no wake trigger found)")

                    except sr.UnknownValueError:
                        continue
                    except sr.RequestError as e:
                        log(f"[AARYA/Listener] Google API error: {e}")
                        time.sleep(2)
                        continue
                    except Exception as e:
                        log(f"[AARYA/Listener] Exception inside recognizer loop: {e}")
                        time.sleep(1)
                        continue

        except Exception as e:
            log(f"[ERROR] Ambient listener outer context error: {e}")
            time.sleep(3)


def main():
    # Enforce thread survival: run listener inside a daemon thread
    listener_thread = threading.Thread(target=listening_loop, daemon=True)
    listener_thread.start()
    
    # Keep the main process alive
    while True:
        try:
            time.sleep(1)
        except KeyboardInterrupt:
            print("[INFO] Exiting Aarya Ambient Listener...")
            break


if __name__ == "__main__":
    main()
