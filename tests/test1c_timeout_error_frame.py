# tests/test1c_timeout_error_frame.py
"""
Test 1C: Forces exceptions in the stream interceptor and verifies
only NDJSON error frames are emitted — never local TTS.
"""

import asyncio
import json
import os
import sys
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

# Resolve paths
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
backend_dir = os.path.join(base_dir, 'backend')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from stream_interceptor import GeminiStreamInterceptor, ErrorCode


@pytest.mark.asyncio
async def test_timeout_produces_error_frame_only():
    """
    Forces a timeout by patching _attempt_stream to raise TimeoutError.
    Verifies: error frame is emitted, no local TTS is called.
    """
    async def mock_attempt(self, query, history, voice):
        raise asyncio.TimeoutError("Forced timeout")
        yield  # Make it an async generator

    with patch.object(GeminiStreamInterceptor, '_attempt_stream', mock_attempt):
        interceptor = GeminiStreamInterceptor(
            timeout=0.001,
            max_retries=0  # No retries for this test
        )

        frames = []
        async for line in interceptor.stream(query="test", history=[]):
            frames.append(json.loads(line))

    # There must be at least one frame
    assert len(frames) >= 1, "No frames received — interceptor returned nothing"

    # The final frame must be an error frame
    final_frame = frames[-1]
    assert final_frame['type'] == 'error', (
        f"Final frame is '{final_frame['type']}' not 'error'. "
        f"Frame: {final_frame}"
    )
    assert final_frame['final'] is True
    assert final_frame['code'] in (ErrorCode.API_TIMEOUT, ErrorCode.STREAM_INTERRUPTED)

    # Verify no pyttsx3 or edge_tts was imported during execution
    assert 'pyttsx3' not in sys.modules, "pyttsx3 was imported during error handling!"
    assert 'edge_tts' not in sys.modules, "edge_tts was imported during error handling!"

    print(f"✅ Timeout test PASSED. Error frame: {final_frame['code']} — No TTS invoked.")


@pytest.mark.asyncio
async def test_api_error_produces_structured_error_frame():
    """Forces a Gemini APIError (e.g., 429) and verifies structured NDJSON error frame."""
    from google.genai import errors as genai_errors

    mock_api_error = genai_errors.APIError(
        code=429,
        response_json={"error": {"code": 429, "message": "Rate limit exceeded"}},
    )
    mock_api_error.status_code = 429
    mock_api_error.code = 429

    async def mock_attempt_429(self, query, history, voice):
        raise mock_api_error
        yield  # Make it an async generator

    with patch.object(GeminiStreamInterceptor, '_attempt_stream', mock_attempt_429):
        interceptor = GeminiStreamInterceptor(max_retries=0)
        frames = []
        async for line in interceptor.stream(query="test", history=[]):
            frames.append(json.loads(line))

    final_frame = frames[-1]
    assert final_frame['type'] == 'error'
    assert final_frame['code'] == ErrorCode.API_QUOTA_EXCEEDED
    assert 'pyttsx3' not in sys.modules
    print(f"✅ 429 error test PASSED. Structured error frame emitted.")
