# backend/startup.py
# Performs API connectivity check before activating microphone handler.
# Uses the modern google.genai SDK (NOT the deprecated google.generativeai).

from __future__ import annotations
import asyncio
import logging
from google import genai
from google.genai import errors as genai_errors
from config import GEMINI_API_KEY, GEMINI_MODEL

logger = logging.getLogger("aarya.startup")

async def run_warmup_handshake() -> dict:
    """
    Sends a minimal probe to Gemini to confirm API key validity and server reachability.
    Returns status dict. Does NOT activate microphone handler on CONFIG_ERROR.
    """
    client = genai.Client(api_key=GEMINI_API_KEY)

    for attempt in range(2):
        try:
            response = await asyncio.wait_for(
                client.aio.models.generate_content(
                    model=GEMINI_MODEL,
                    contents="ping",
                    config={"max_output_tokens": 1},
                ),
                timeout=3.0
            )
            logger.info(f"[Warmup] API handshake successful on attempt {attempt+1}")
            return {"status": "AVAILABLE", "attempt": attempt + 1}

        except asyncio.TimeoutError:
            logger.warning(f"[Warmup] Timeout on attempt {attempt+1}")
            if attempt < 1:
                await asyncio.sleep(2.0)
                continue
            return {"status": "DEGRADED", "reason": "timeout"}

        except genai_errors.APIError as e:
            status_code = getattr(e, 'status_code', None) or getattr(e, 'code', 0)
            if status_code in (401, 403):
                logger.critical(f"[Warmup] AUTH FAILURE — API key invalid: {e}")
                return {"status": "CONFIG_ERROR", "reason": "auth_failure", "detail": str(e)}
            logger.warning(f"[Warmup] APIError on attempt {attempt+1}: {e}")
            if attempt < 1:
                await asyncio.sleep(2.0)
                continue
            return {"status": "DEGRADED", "reason": str(e)}

        except Exception as e:
            logger.warning(f"[Warmup] Unexpected error on attempt {attempt+1}: {e}")
            if attempt < 1:
                await asyncio.sleep(2.0)
                continue
            return {"status": "DEGRADED", "reason": str(e)}

    return {"status": "DEGRADED", "reason": "max_attempts_exceeded"}
