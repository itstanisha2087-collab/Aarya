import asyncio
import os
import io
import wave
from pathlib import Path
from dotenv import load_dotenv

# Load env variables from absolute path
backend_dir = os.path.dirname(os.path.abspath(__file__))
dotenv_path = os.path.join(backend_dir, ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path=dotenv_path)

CONFIRMATIONS = {
    "confirm_yes_sir":      "Yes sir, I am listening.",
    "confirm_greetings_sir": "Greetings sir. I am ready.",
    "confirm_ready":        "I am ready.",
}

VOICE = os.environ.get("AARYA_VOICE_PROFILE", "Aoede")
MODEL = "gemini-2.5-flash-preview-tts"  # model optimized for TTS

async def generate_and_save(client, name: str, text: str):
    from google.genai import types
    assets_dir = Path(backend_dir) / "assets"
    assets_dir.mkdir(exist_ok=True)
    out_path = assets_dir / f"{name}.wav"

    response = await client.aio.models.generate_content(
        model=MODEL,
        contents=[{"role": "user", "parts": [{"text": text}]}],
        config=types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(
                voice_config=types.VoiceConfig(
                    prebuilt_voice_config=types.PrebuiltVoiceConfig(
                        voice_name=VOICE
                    )
                )
            ),
        ),
    )

    pcm_bytes = None
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            pcm_bytes = part.inline_data.data
            break

    if not pcm_bytes:
        raise RuntimeError(f"No audio returned for: {text}")

    # Wrap PCM in WAV container
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(24000)
        wf.writeframes(pcm_bytes)

    out_path.write_bytes(buf.getvalue())
    print(f"[Generated] {out_path}  ({len(pcm_bytes):,} PCM bytes)")

async def main():
    from google import genai
    api_key = os.environ["GEMINI_API_KEY"]
    client = genai.Client(api_key=api_key)
    for name, text in CONFIRMATIONS.items():
        try:
            await generate_and_save(client, name, text)
        except Exception as e:
            print(f"Failed to generate {name}: {e}")

    # Also create the legacy fallback_confirm.wav for full backward compatibility
    legacy_path = Path(backend_dir) / "assets" / "fallback_confirm.wav"
    primary_path = Path(backend_dir) / "assets" / "confirm_yes_sir.wav"
    if primary_path.exists() and not legacy_path.exists():
        import shutil
        shutil.copy(primary_path, legacy_path)
        print(f"[Copied] {legacy_path} for backward compatibility.")

    print("All confirmation audio assets generated.")

if __name__ == "__main__":
    asyncio.run(main())
