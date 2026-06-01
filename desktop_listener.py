import pyaudio
import audioop
import wave
import io
import os
import sys
import time
import requests
import threading
import winsound

# Set standard streams to UTF-8 to prevent encoding crashes on Windows
sys.stdout.reconfigure(encoding='utf-8')
sys.stderr.reconfigure(encoding='utf-8')

print("==================================================")
print("      AARYA Ambient Voice Listener Active         ")
print("==================================================")
print("Running inside an active desktop session with direct mic access.")

# Audio configuration
FORMAT = pyaudio.paInt16
CHANNELS = 1
RATE = 16000
CHUNK = 256 # 256 samples per chunk = 16ms duration

BACKEND_BASE_URL = "http://127.0.0.1:8000"
BACKEND_AMBIENT_URL = f"{BACKEND_BASE_URL}/api/ambient-query"
BACKEND_TRANSCRIBE_URL = f"{BACKEND_BASE_URL}/transcribe"
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
        requests.post("http://127.0.0.1:3001/wake", json={}, timeout=1.0)
        log("[AARYA/Listener] Sent instant direct Electron wake IPC signal.")
    except Exception as e:
        log(f"[AARYA/Listener] Instant wake signal failed: {e}")

def send_ambient_query(query):
    """Send ambient voice query payload silently to FastAPI backend as a single-pass execution."""
    log(f"[AARYA/Listener] Dispatched query: '{query}'")
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
            log(f"[AARYA/Listener] Query SUCCESS: {res.json()}")
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
    triggers = ["aarya", "arya", "aria", "ariya", "aariya"]
    
    matched_trigger = None
    trigger_index = -1
    
    for trig in triggers:
        idx = text_clean.find(trig)
        if idx != -1:
            if trigger_index == -1 or idx < trigger_index:
                trigger_index = idx
                matched_trigger = trig
                
    if matched_trigger is None:
        return False, ""

    prefix = text_clean[:trigger_index].strip()
    suffix = text_clean[trigger_index + len(matched_trigger):].strip()
    query = f"{prefix} {suffix}".strip()
    query = query.strip(",.:;!? ")
    
    words = query.split()
    if not words:
        return True, "hello"
        
    greetings = {"hello", "hey", "hi", "wake", "up", "suno", "please", "yo", "oi"}
    while words and words[0].strip(",.:;!? ") in greetings:
        words.pop(0)
        
    query_clean = " ".join(words).strip(",.:;!? ")
    if not query_clean:
        return True, "hello"
        
    return True, query_clean

def check_playback_state():
    """Returns True if the backend reports that audio output is currently speaking."""
    try:
        res = requests.get(f"{BACKEND_BASE_URL}/api/playback-state", timeout=0.5)
        if res.status_code == 200:
            return res.json().get("is_speaking", False)
    except Exception:
        pass
    return False

def pcm_to_wav_bytes(pcm_chunks):
    """Converts a sequence of Int16 PCM chunks into in-memory WAV file bytes."""
    wav_buffer = io.BytesIO()
    with wave.open(wav_buffer, "wb") as wf:
        wf.setnchannels(CHANNELS)
        wf.setsampwidth(2) # 16-bit
        wf.setframerate(RATE)
        wf.writeframes(b"".join(pcm_chunks))
    return wav_buffer.getvalue()

def transcribe_audio_bytes(wav_bytes):
    """Sends WAV bytes to backend /transcribe endpoint to get Whisper transcription."""
    try:
        files = {"audio": ("speech.wav", wav_bytes, "audio/wav")}
        data = {"language": "english"}
        res = requests.post(BACKEND_TRANSCRIBE_URL, files=files, data=data, timeout=10.0)
        if res.status_code == 200:
            return res.json().get("text", "").strip()
    except Exception as e:
        log(f"[AARYA/Listener] Transcription failed: {e}")
    return ""

def listening_loop():
    p = pyaudio.PyAudio()
    
    try:
        stream = p.open(
            format=FORMAT,
            channels=CHANNELS,
            rate=RATE,
            input=True,
            frames_per_buffer=CHUNK
        )
    except Exception as e:
        log(f"[AARYA/Listener] Failed to open audio device: {e}")
        return

    log("[AARYA/Listener] Microphone stream opened and PERMANENTLY ON.")
    
    # VAD state tracking parameters
    ambient_energy = 250.0
    speech_active = False
    speech_buffer = []
    silence_chunks = 0
    pre_speech_buffer = []
    
    # Strict VAD limits
    # 800ms silence threshold: 800ms / 16ms per chunk = 50 chunks
    SILENCE_LIMIT_CHUNKS = 50
    # 1.5 seconds maximum pre-speech buffer: 1.5s / 16ms = 93 chunks
    PRE_SPEECH_LIMIT_CHUNKS = 93
    
    log("[AARYA/Listener] Starting continuous PyAudio dynamic VAD loop...")
    
    while True:
        try:
            # Check playback state to avoid self-feedback
            if check_playback_state():
                time.sleep(0.1)
                pre_speech_buffer.clear()
                continue
                
            # Read mic chunk
            data = stream.read(CHUNK, exception_on_overflow=False)
            if not data:
                continue
                
            # Compute RMS energy of raw Int16 PCM chunk
            rms = audioop.rms(data, 2)
            
            # Dynamic ambient noise floor adaptation during silence
            if not speech_active:
                ambient_energy = (ambient_energy * 0.99) + (rms * 0.01)
                ambient_energy = max(ambient_energy, 100.0) # floor limit
                
            # Check voice activity threshold (adapted based on noise floor)
            threshold = ambient_energy * 1.5 + 120
            
            if rms > threshold:
                if not speech_active:
                    log(f"[AARYA/Listener] Voice activity detected! (RMS: {rms:.1f} | Threshold: {threshold:.1f})")
                    speech_active = True
                    speech_buffer = list(pre_speech_buffer)
                    silence_chunks = 0
                
                speech_buffer.append(data)
                silence_chunks = 0
            else:
                if speech_active:
                    speech_buffer.append(data)
                    silence_chunks += 1
                    
                    # Enforce strict 800ms silence VAD cutoff
                    if silence_chunks >= SILENCE_LIMIT_CHUNKS:
                        log(f"[AARYA/Listener] Silence detected for 800ms. Cutting recording...")
                        speech_active = False
                        
                        captured_pcm = list(speech_buffer[:-silence_chunks]) # strip silence padding
                        speech_buffer.clear()
                        
                        if len(captured_pcm) > 10: # skip empty background ticks
                            threading.Thread(target=process_speech_phrase, args=(captured_pcm,), daemon=True).start()
                else:
                    # Maintain pre-speech buffer
                    pre_speech_buffer.append(data)
                    if len(pre_speech_buffer) > PRE_SPEECH_LIMIT_CHUNKS:
                        pre_speech_buffer.pop(0)
                        
        except Exception as e:
            log(f"[AARYA/Listener] Error in listen loop: {e}")
            time.sleep(0.1)

def process_speech_phrase(pcm_chunks):
    """Processes recorded PCM phrase in background thread to avoid blocking the main audio capture stream."""
    wav_bytes = pcm_to_wav_bytes(pcm_chunks)
    text = transcribe_audio_bytes(wav_bytes)
    if not text:
        return
        
    log(f"[AARYA/Listener] Heard: \"{text}\"")
    matched, query = parse_ambient_command(text)
    if matched:
        log(f"[AARYA/Listener] Wake-word matched! Extracting query: '{query}'")
        # Trigger instant foregrounding in background thread
        threading.Thread(target=trigger_electron_wake, daemon=True).start()
        # Dispatch query async to backend
        send_ambient_query_async(query)
    else:
        # If AARYA is in continuous dialogue mode (ACTIVE), send speech query directly without wake word
        try:
            res = requests.get(f"{BACKEND_BASE_URL}/api/v1/state", timeout=0.5)
            if res.status_code == 200:
                state_data = res.json()
                current_state = state_data.get("current_state", 0)
                if current_state == 2: # ACTIVE state
                    log(f"[AARYA/Listener] Continuous dialogue active. Dispatching query: '{text}'")
                    send_ambient_query_async(text)
        except Exception as e:
            log(f"[AARYA/Listener] Failed to fetch FSM state: {e}")

def main():
    listener_thread = threading.Thread(target=listening_loop, daemon=True)
    listener_thread.start()
    while True:
        try:
            time.sleep(1)
        except KeyboardInterrupt:
            print("[INFO] Exiting Aarya Ambient Listener...")
            break

if __name__ == "__main__":
    main()
