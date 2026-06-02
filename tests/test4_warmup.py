# tests/test4_warmup.py
"""
Test 4: Verifies the behavior of the API warm-up handshake.
Uses the modern google.genai SDK mocks.
"""

import asyncio
import os
import sys
import pytest
from unittest.mock import patch, AsyncMock, MagicMock

# Resolve paths
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
backend_dir = os.path.join(base_dir, 'backend')
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from startup import run_warmup_handshake
from google.genai import errors as genai_errors


@pytest.mark.asyncio
async def test_warmup_returns_available_on_success():
    """Valid API key + reachable server → AVAILABLE status."""
    mock_response = type('R', (), {'text': 'ok'})()
    
    # Mock the async generate_content call on the client.aio.models path
    mock_aio_models = AsyncMock()
    mock_aio_models.generate_content = AsyncMock(return_value=mock_response)
    
    mock_aio = MagicMock()
    mock_aio.models = mock_aio_models
    
    mock_client = MagicMock()
    mock_client.aio = mock_aio
    
    with patch('startup.genai.Client', return_value=mock_client):
        result = await run_warmup_handshake()

    assert result['status'] == 'AVAILABLE'
    print(f"✅ Warmup AVAILABLE test PASSED: {result}")


@pytest.mark.asyncio
async def test_warmup_returns_config_error_on_401():
    """Invalid API key → CONFIG_ERROR, mic handler must not start."""
    auth_error = genai_errors.APIError(
        code=401,
        response_json={"error": {"code": 401, "message": "Invalid API key"}},
    )
    auth_error.status_code = 401
    auth_error.code = 401

    mock_aio_models = AsyncMock()
    mock_aio_models.generate_content = AsyncMock(side_effect=auth_error)
    
    mock_aio = MagicMock()
    mock_aio.models = mock_aio_models
    
    mock_client = MagicMock()
    mock_client.aio = mock_aio
    
    with patch('startup.genai.Client', return_value=mock_client):
        result = await run_warmup_handshake()

    assert result['status'] == 'CONFIG_ERROR'
    assert result['reason'] == 'auth_failure'
    print(f"✅ Warmup CONFIG_ERROR test PASSED: {result}")


@pytest.mark.asyncio
async def test_warmup_returns_degraded_on_timeout():
    """Network timeout → DEGRADED (not CONFIG_ERROR — mic handler can still start)."""
    mock_aio_models = AsyncMock()
    mock_aio_models.generate_content = AsyncMock(side_effect=asyncio.TimeoutError())
    
    mock_aio = MagicMock()
    mock_aio.models = mock_aio_models
    
    mock_client = MagicMock()
    mock_client.aio = mock_aio
    
    with patch('startup.genai.Client', return_value=mock_client):
        result = await run_warmup_handshake()

    assert result['status'] == 'DEGRADED'
    assert result['reason'] == 'timeout'
    print(f"✅ Warmup DEGRADED test PASSED: {result}")
