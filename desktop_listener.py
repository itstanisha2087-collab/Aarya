import os
import sys
import time
import requests
import winsound
import speech_recognition as sr

# Set standard streams to UTF-8
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

print("==================================================")
print("      AARYA Ambient Voice Listener Active         ")
print("==================================================")
print("Running inside an active desktop session with direct mic access.")

# ── Wake phrase configuration ──
# Primary exact matches
WAKE_PHRASES_EXACT = ["hello aarya", "wake up aarya"]

# Fuzzy matches: Google Speech Recognition often transcribes "Aarya" as
# these phonetic variants depending on accent, speed, and mic quality.
WAKE_PHRASES_FUZZY = [
    "hello arya", "hello aria", "hello area", "hello ariya",
    "hello aariya", "hello airya", "hello arrea",
    "helloaarya", "helloarya", "helloaria",
    "hey aarya", "hey arya", "hey aria",
    "wake up arya", "wake up aria", "wake up area",
    "wake up ariya", "wakeup aarya", "wakeup arya",
]

ALL_WAKE_PHRASES = WAKE_PHRASES_EXACT + WAKE_PHRASES_FUZZY

BACKEND_WAKE_URL = "http://127.0.0.1:8000/api/wake-ui"
ELECTRON_WAKE_URL = "http://127.0.0.1:3001/wake"
COOLDOWN_SECONDS = 15
last_wake_time = 0

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
    try:
        winsound.Beep(880, 200)
        winsound.Beep(1100, 250)
    except Exception as e:
        log(f"[AARYA/Listener] Beep synthesis failed: {e}")


def trigger_ui_wake():
    global last_wake_time
    now = time.time()
    if now - last_wake_time < COOLDOWN_SECONDS:
        log("[AARYA/Listener] Wake triggered too recently. Cooldown active.")
        return

    last_wake_time = now
    log("[AARYA/Listener] ★★★ WAKE PHRASE DETECTED! Playing chimes and waking UI... ★★★")
    play_chime()

    # Try direct Electron IPC first (faster, no backend middleman)
    try:
        res = requests.post(ELECTRON_WAKE_URL, json={}, timeout=1.5)
        if res.status_code == 200:
            log(f"[AARYA/Listener] Electron direct wake SUCCESS: {res.json()}")
            return
        else:
            log(f"[AARYA/Listener] Electron direct wake returned: {res.status_code}")
    except Exception as e:
        log(f"[AARYA/Listener] Electron direct wake failed: {e}")

    # Fallback: relay through FastAPI backend
    try:
        res = requests.post(BACKEND_WAKE_URL, json={}, timeout=2.0)
        if res.status_code == 200:
            log(f"[AARYA/Listener] Backend relay wake SUCCESS: {res.json()}")
        else:
            log(f"[AARYA/Listener] Backend returned error status: {res.status_code}")
    except Exception as e:
        log(f"[AARYA/Listener] Backend connection failed: {e}")


def check_wake_match(text):
    """Check if transcribed text contains a wake phrase (exact or fuzzy)."""
    text_clean = text.lower().strip()

    # Exact match
    for phrase in WAKE_PHRASES_EXACT:
        if phrase in text_clean:
            return True, f"EXACT: '{phrase}'"

    # Fuzzy match
    for phrase in WAKE_PHRASES_FUZZY:
        if phrase in text_clean:
            return True, f"FUZZY: '{phrase}'"

    # Substring check: if "aarya" or common variants appear anywhere
    core_names = ["aarya", "arya", "aria", "ariya"]
    for name in core_names:
        if name in text_clean:
            # Must also have a greeting prefix nearby
            greetings = ["hello", "hey", "hi", "wake", "yo", "oi"]
            if any(g in text_clean for g in greetings):
                return True, f"CORE+GREETING: '{name}' with greeting"

    return False, None


def main():
    r = sr.Recognizer()

    # ═══════════════════════════════════════════════════════════
    # CRITICAL FIX: Use an optimal static threshold of 50.
    # The Realtek Microphone Array on this machine produces:
    #   - Ambient RMS: ~0-5 (occasional peaks up to 45)
    #   - Normal speech RMS: 50-260
    #   - Peak speech RMS: ~350 (average peak ~100 in quiet room)
    # A static threshold of 300 was filtering out 95% of speech.
    # But dynamic threshold calibrated down to 1, causing constant
    # loops triggering on silence/static.
    # A static threshold of 50 perfectly ignores silent background
    # static (peaks up to 45) while easily triggering on speech (~100 RMS).
    # ═══════════════════════════════════════════════════════════
    r.dynamic_energy_threshold = False
    r.energy_threshold = 50
    r.pause_threshold = 0.8  # Seconds of silence before phrase is considered complete
    r.phrase_threshold = 0.3  # Minimum seconds of audio to consider as speech

    log(f"[AARYA/Listener] Static energy_threshold = {r.energy_threshold}")
    log(f"[AARYA/Listener] dynamic_energy_threshold = {r.dynamic_energy_threshold}")

    while True:
        try:
            with sr.Microphone() as source:
                # Disable ambient calibration as it overwrites our optimal threshold
                log("[AARYA/Listener] ✓ Continuous listening active with static threshold. Say 'Hello Aarya' or 'Wake up Aarya'...")

                while True:
                    try:
                        # Increased phrase_time_limit to 5s to capture full wake phrase
                        audio = r.listen(source, timeout=8, phrase_time_limit=5.0)
                        try:
                            text = r.recognize_google(audio).lower().strip()
                            log(f"[AARYA/Listener] Heard: \"{text}\"")

                            matched, match_info = check_wake_match(text)
                            if matched:
                                log(f"[AARYA/Listener] ★ WAKE MATCH ({match_info}) ★")
                                trigger_ui_wake()
                            else:
                                log(f"[AARYA/Listener] (no wake match)")

                        except sr.UnknownValueError:
                            # Speech was detected but could not be recognized
                            log("[AARYA/Listener] [?] Audio detected, recognition failed (UnknownValueError)")
                        except sr.RequestError as e:
                            log(f"[AARYA/Listener] [!] Google API error: {e}")
                            time.sleep(3)

                    except sr.WaitTimeoutError:
                        # No speech detected within timeout — normal, keep listening
                        continue
                    except Exception as e:
                        log(f"[AARYA/Listener] Mic stream interrupted: {e}")
                        time.sleep(2)
                        break

        except Exception as e:
            log(f"[AARYA/Listener] Microphone unavailable: {e}")
            log("[AARYA/Listener] Retrying microphone connection in 5 seconds...")
            time.sleep(5)


if __name__ == "__main__":
    main()
