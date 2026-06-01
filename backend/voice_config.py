# voice_config.py — TTS command factory with SSML injection

import re

VOICE_PRIMARY  = "en-IN-NeerjaNeural"
VOICE_FALLBACK = "en-IN-PrabhatNeural"

SSML_TEMPLATE = """
<speak version="1.0"
       xmlns="http://www.w3.org/2001/10/synthesis"
       xmlns:mstts="http://www.w3.org/2001/mstts"
       xml:lang="en-IN">
  <voice name="{voice}">
    <mstts:express-as style="customerservice" styledegree="1.8">
      <prosody rate="+18%" pitch="+4%" volume="loud">
        <mstts:silence type="comma-exact" value="60ms"/>
        <mstts:silence type="sentence-boundary-exact" value="80ms"/>
        <mstts:silence type="leading-exact" value="0ms"/>
        <mstts:silence type="tailing-exact" value="0ms"/>
        {text}
      </prosody>
    </mstts:express-as>
  </voice>
</speak>
"""

def build_ssml(text: str, voice: str = VOICE_PRIMARY) -> str:
    """Injects response text into SSML template. Escapes XML special characters."""
    safe_text = (
        text
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
    return SSML_TEMPLATE.format(voice=voice, text=safe_text).strip()

def preprocess_for_tts(text: str) -> str:
    """
    Cleans markdown artifacts and optimizes punctuation for TTS delivery.
    Applied only to the audio-layer string, never to the screen markdown payload.
    """
    if not text:
        return ""
    
    # Strip headers
    text = re.sub(r'#{1,6}\s*', '', text)
    # Strip bold / italic markers
    text = re.sub(r'\*{1,2}([^*]+)\*{1,2}', r'\1', text)
    # Strip code block contents entirely (prevent spelling out blocks of code)
    text = re.sub(r'```[a-zA-Z0-9]*\n[\s\S]*?\n```', ' ', text)
    # Strip inline code formatting backticks
    text = re.sub(r'`[^`]+`', lambda m: m.group(0).strip('`'), text)
    # Strip markdown link syntax, keep only anchor text
    text = re.sub(r'\[([^\]]+)\]\([^\)]+\)', r'\1', text)
    # Strip bullet point markers
    text = re.sub(r'^\s*[-*+]\s+', '', text, flags=re.MULTILINE)
    # Collapse multiple newlines and spaces
    text = re.sub(r'\n{2,}', ' ', text)
    text = re.sub(r'\n', ' ', text)
    text = re.sub(r'\s{2,}', ' ', text)
    # Reduce ellipsis pauses
    text = re.sub(r'\.{2,}', '.', text)
    
    # Replace AARYA with Aarya to prevent spelling it out
    text = text.replace("AARYA", "Aarya").replace("aarya", "Aarya")
    
    # Acronyms mapping for standard pronunciation
    acronyms = {
        "API": "A-P-I",
        "api": "A-P-I",
        "IPC": "I-P-C",
        "ipc": "I-P-C",
        "TTS": "T-T-S",
        "tts": "T-T-S",
        "UI": "U-I",
        "ui": "U-I",
        "UX": "U-X",
        "ux": "U-X",
        "FastAPI": "Fast A-P-I",
        "fastapi": "Fast A-P-I",
        "Next.js": "Next J-S",
        "next.js": "Next J-S"
    }
    
    words = text.split()
    normalized = []
    for w in words:
        clean_w = w.strip(".,!?()[]{}\"'")
        if clean_w in acronyms:
            replaced = w.replace(clean_w, acronyms[clean_w])
            normalized.append(replaced)
        else:
            normalized.append(w)
            
    text = " ".join(normalized)
    
    # Symbols cleaning
    text = text.replace("&", " and ").replace("@", " at ").replace("#", "")
    
    return text.strip()

def build_tts_command(text: str) -> list[str]:
    """
    Returns the shell command list for edge-tts synthesis.
    """
    # edge-tts writes to stdout; mpv reads from stdin
    return [
        "edge-tts",
        "--voice", VOICE_PRIMARY,
        "--rate", "+18%",
        "--pitch", "+4Hz",
        "--text", text,
        "--write-media", "-"
    ]
