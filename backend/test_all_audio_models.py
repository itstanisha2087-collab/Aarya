import os
from google import genai
from google.genai import types

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AQ.Ab8RN6IETnrokWloLCKz1BoIFCPOAbyx1FugL-REnMNO_2HISw")
client = genai.Client(api_key=GEMINI_API_KEY)

candidate_models = [
    "gemini-3.1-flash-tts-preview",
    "gemini-2.5-flash-preview-tts",
]

for model in candidate_models:
    print(f"\nTrying {model}...")
    try:
        # Let's try to request just AUDIO, which we know worked for 2.5-flash-preview-tts.
        # Let's see if 3.1-flash-tts-preview also works.
        response = client.models.generate_content(
            model=model,
            contents="Say 'Hi Ayush, I am AARYA, your native multimodal desktop companion.'",
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name="Aoede"
                        )
                    )
                ),
            ),
        )
        print(f"SUCCESS for {model}!")
        print(f"Response parts count: {len(response.candidates[0].content.parts)}")
        for i, part in enumerate(response.candidates[0].content.parts):
            print(f"  Part {i}: inline_data: {part.inline_data is not None}, text: {part.text is not None}")
            if part.inline_data:
                print(f"    mime_type: {part.inline_data.mime_type}")
                print(f"    data length: {len(part.inline_data.data)} bytes")
            if part.text:
                print(f"    text: {part.text}")
    except Exception as e:
        print(f"FAILED for {model}: {e}")
