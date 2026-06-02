# tests/test5_health.py
"""
Test 5: The /health endpoint must report voice_pipeline=gemini_native_only
and legacy_tts=purged. Any other values indicate incomplete purge.
"""

import httpx
import pytest


@pytest.mark.asyncio
async def test_health_endpoint_reports_purged_state():
    """
    The /health endpoint must report voice_pipeline=gemini_native_only
    and legacy_tts=purged. Any other values indicate incomplete purge.
    """
    async with httpx.AsyncClient() as client:
        response = await client.get('http://127.0.0.1:8000/health', timeout=15.0)

    assert response.status_code == 200
    data = response.json()

    assert data['voice_pipeline'] == 'gemini_native_only', (
        f"FAIL: voice_pipeline is '{data['voice_pipeline']}' — expected 'gemini_native_only'"
    )
    assert data['legacy_tts'] == 'purged', (
        f"FAIL: legacy_tts is '{data['legacy_tts']}' — expected 'purged'. "
        f"This indicates the Phase 1 purge is incomplete."
    )
    assert data['model'] == 'gemini-2.5-flash', (
        f"FAIL: model is '{data['model']}' — must be locked to 'gemini-2.5-flash'"
    )

    print(f"✅ Health endpoint test PASSED: {data}")
