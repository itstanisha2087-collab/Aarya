import base64
from io import BytesIO
from PIL import ImageGrab

import gc

def capture_and_encode_screen():
    """
    Captures the primary desktop screen, compresses it into a high-performance
    JPEG buffer at quality 70, and encodes it into a standard base64 string.
    Ensures absolute freshness and releases internal image objects immediately.
    """
    print("[VISION] Fresh screenshot captured")
    screenshot = ImageGrab.grab()
    try:
        buffered = BytesIO()
        screenshot.save(buffered, format="JPEG", quality=70)
        img_bytes = buffered.getvalue()
        encoded = base64.b64encode(img_bytes).decode("utf-8")
        buffered.close()
        return encoded
    finally:
        # Explicitly release image and garbage collect to prevent any cached/stale states
        screenshot.close()
        del screenshot
        gc.collect()
