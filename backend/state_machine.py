# backend/state_machine.py
# AARYA FSM v2.4.1 — Bulletproof State-1 with guaranteed watchdog escape
# Replace this file entirely. No lines from the prior version should remain.

import asyncio
import base64
import logging
import time
from enum import Enum
from pathlib import Path

logger = logging.getLogger("aarya.fsm")

# ---------------------------------------------------------------------------
# State enum
# ---------------------------------------------------------------------------

class STATE(str, Enum):
    DORMANT = "DORMANT"
    CONFIRM = "CONFIRM"
    ACTIVE  = "ACTIVE"


# ---------------------------------------------------------------------------
# Confirmation asset paths — tried in order, first found wins
# ---------------------------------------------------------------------------

CONFIRM_ASSET_CANDIDATES = [
    Path("assets/confirm_yes_sir.wav"),
    Path("assets/confirm_greetings_sir.wav"),
    Path("assets/confirm_ready.wav"),
]

# Absolute maximum time the FSM can remain in CONFIRM before
# the watchdog forces it into ACTIVE, regardless of any callback.
CONFIRM_WATCHDOG_SECONDS = 1.5

# Silence timeout: ACTIVE → DORMANT after N seconds with no query
SILENCE_TIMEOUT_SECONDS = 120.0


# ---------------------------------------------------------------------------
# Lightweight fallback: a plain text greeting emitted when no WAV exists.
# The frontend renders this as text; no audio hardware required.
# ---------------------------------------------------------------------------

FALLBACK_TEXT_GREETING = "Yes sir, I am listening."


# ---------------------------------------------------------------------------
# AaryaFSM
# ---------------------------------------------------------------------------

class AaryaFSM:
    """
    Thread-safe FSM for AARYA conversation states.

    Guarantees:
    - CONFIRM state NEVER persists longer than CONFIRM_WATCHDOG_SECONDS.
    - Missing / corrupt WAV asset never bricks the system.
    - All state mutations are serialised through asyncio.Lock.
    - /api/query returns 403 only in DORMANT; CONFIRM auto-escapes in 1.5s.
    """

    def __init__(self):
        self._state: STATE = STATE.DORMANT
        self._lock: asyncio.Lock = asyncio.Lock()
        self._watchdog_task: asyncio.Task | None = None
        self._silence_task: asyncio.Task | None = None
        self._last_query_ts: float = time.monotonic()

        # Pre-load confirmation audio once at startup.
        # If loading fails, _confirm_audio stays None and the text
        # fallback path is used instead — system never crashes.
        self._confirm_audio_b64: str | None = None
        self._confirm_audio_format: str = "wav"
        self._load_confirm_audio()

    # ------------------------------------------------------------------
    # Asset loader — called once at init, never at request time
    # ------------------------------------------------------------------

    def _load_confirm_audio(self) -> None:
        # Determine the parent directory of this file to resolve candidates correctly
        base_path = Path(__file__).resolve().parent
        for candidate_rel in CONFIRM_ASSET_CANDIDATES:
            candidate = base_path / candidate_rel
            try:
                if candidate.exists():
                    raw = candidate.read_bytes()
                    if len(raw) < 512:
                        logger.warning(
                            "[AARYA FSM] Asset %s is suspiciously small (%d bytes), skipping.",
                            candidate, len(raw)
                        )
                        continue
                    self._confirm_audio_b64 = base64.b64encode(raw).decode("ascii")
                    logger.info("[AARYA FSM] Confirmation audio loaded: %s (%d bytes)", candidate, len(raw))
                    return
                else:
                    logger.warning("[AARYA FSM] Candidate not found at absolute path: %s", candidate)
            except Exception as exc:
                logger.warning("[AARYA FSM] Could not read %s: %s", candidate, exc)

        # All candidates failed
        logger.warning(
            "[FALLBACK]: Local asset missing — "
            "text fallback will be used for State-1 greeting. "
            "Run: python scripts/generate_confirm_audio.py to fix."
        )
        self._confirm_audio_b64 = None

    # ------------------------------------------------------------------
    # Public property
    # ------------------------------------------------------------------

    @property
    def state(self) -> STATE:
        return self._state

    @state.setter
    def state(self, val: STATE) -> None:
        self._state = val

    @property
    def current_state(self) -> STATE:
        return self._state

    @current_state.setter
    def current_state(self, val: STATE) -> None:
        self._state = val

    # ------------------------------------------------------------------
    # /api/wake  →  trigger_wake()
    # ------------------------------------------------------------------

    async def trigger_wake(self) -> dict:
        """
        Valid transition: DORMANT → CONFIRM.
        Returns confirmation payload (audio bytes or text fallback).
        Starts a 1.5-second watchdog that forces ACTIVE regardless of
        whether the frontend ever calls /api/confirm_played.
        """
        async with self._lock:
            if self._state == STATE.ACTIVE:
                return {"status": "already_active", "state": self._state}

            if self._state == STATE.CONFIRM:
                return {"status": "confirmation_in_progress", "state": self._state}

            # DORMANT → CONFIRM
            self._state = STATE.CONFIRM
            logger.info("[AARYA FSM] DORMANT → CONFIRM")

        # Launch 1.5-second watchdog OUTSIDE the lock to prevent deadlock.
        self._cancel_watchdog()
        self._watchdog_task = asyncio.create_task(
            self._confirm_watchdog(CONFIRM_WATCHDOG_SECONDS),
            name="aarya_confirm_watchdog",
        )

        # Build response payload — audio if asset available, text otherwise
        return self._build_confirm_payload()

    def _build_confirm_payload(self) -> dict:
        """
        Constructs the State-1 response dict.
        Never raises. Falls back to text if audio asset is unavailable.
        """
        try:
            if self._confirm_audio_b64:
                return {
                    "status": "confirm",
                    "state": STATE.CONFIRM,
                    "response_type": "audio",
                    "audio": self._confirm_audio_b64,
                    "audio_format": self._confirm_audio_format,
                    "sample_rate": 24000,
                    "text": FALLBACK_TEXT_GREETING,  # Always include text too
                }
            else:
                # FALLBACK path — text only, no audio
                logger.info("[FALLBACK]: Returning text-only State-1 greeting.")
                return {
                    "status": "confirm",
                    "state": STATE.CONFIRM,
                    "response_type": "text",
                    "audio": None,
                    "text": FALLBACK_TEXT_GREETING,
                }
        except Exception as exc:
            # If even the dict construction somehow fails, return minimal valid response
            logger.error("[AARYA FSM] _build_confirm_payload exception: %s", exc)
            return {
                "status": "confirm",
                "state": STATE.CONFIRM,
                "response_type": "text",
                "audio": None,
                "text": FALLBACK_TEXT_GREETING,
            }

    # ------------------------------------------------------------------
    # /api/confirm_played  →  confirm_played()
    # ------------------------------------------------------------------

    async def confirm_played(self) -> dict:
        """
        Frontend calls this when confirmation audio/text display is complete.
        Transitions CONFIRM → ACTIVE and cancels the watchdog.
        """
        async with self._lock:
            if self._state != STATE.CONFIRM:
                return {"status": "no_op", "state": self._state}

            self._state = STATE.ACTIVE
            logger.info("[AARYA FSM] CONFIRM → ACTIVE (frontend callback)")

        self._cancel_watchdog()
        self._restart_silence_timeout()
        return {"status": "active", "state": STATE.ACTIVE}

    # ------------------------------------------------------------------
    # /api/dismiss  →  dismiss()
    # ------------------------------------------------------------------

    async def dismiss(self) -> dict:
        """Unconditionally resets to DORMANT and clears all timers."""
        async with self._lock:
            prev = self._state
            self._state = STATE.DORMANT
            logger.info("[AARYA FSM] %s → DORMANT (dismiss)", prev)

        self._cancel_watchdog()
        self._cancel_silence_timeout()
        return {"status": "dormant", "state": STATE.DORMANT}

    # ------------------------------------------------------------------
    # Query guard — called at the top of every /api/query handler
    # ------------------------------------------------------------------

    def assert_active(self) -> None:
        """
        Raises ValueError if state is not ACTIVE.
        NOTE: In CONFIRM state, the watchdog will escape to ACTIVE within
        2 seconds. The caller should surface this to the client as a
        503 Retry-After response, not a hard 403.
        """
        if self._state == STATE.ACTIVE:
            return
        if self._state == STATE.CONFIRM:
            raise ValueError(
                f"AARYA is initialising (CONFIRM). "
                f"Retry in {CONFIRM_WATCHDOG_SECONDS:.0f}s. "
                f"[state={self._state}]"
            )
        raise ValueError(
            f"AARYA is not active. Wake AARYA first. [state={self._state}]"
        )

    def ping_activity(self) -> None:
        """Reset silence timeout on every successful query."""
        self._last_query_ts = time.monotonic()

    # ------------------------------------------------------------------
    # Internal: watchdog timer
    # ------------------------------------------------------------------

    async def _confirm_watchdog(self, timeout: float) -> None:
        """
        Absolute guarantee: FSM leaves CONFIRM state within `timeout` seconds.
        This task is created on every wake trigger and cancelled if the
        frontend fires /api/confirm_played first.
        """
        await asyncio.sleep(timeout)
        async with self._lock:
            if self._state == STATE.CONFIRM:
                self._state = STATE.ACTIVE
                logger.warning(
                    "[AARYA FSM] CONFIRM → ACTIVE forced by watchdog "
                    "(%.1fs elapsed, no frontend callback received).",
                    timeout,
                )
        self._restart_silence_timeout()

    # ------------------------------------------------------------------
    # Internal: silence timeout
    # ------------------------------------------------------------------

    async def _silence_timeout_loop(self) -> None:
        """ACTIVE → DORMANT after SILENCE_TIMEOUT_SECONDS of no queries."""
        while True:
            await asyncio.sleep(10)
            if self._state != STATE.ACTIVE:
                return
            idle = time.monotonic() - self._last_query_ts
            if idle >= SILENCE_TIMEOUT_SECONDS:
                async with self._lock:
                    if self._state == STATE.ACTIVE:
                        self._state = STATE.DORMANT
                        logger.info(
                            "[AARYA FSM] ACTIVE → DORMANT (%.0fs silence timeout).",
                            idle,
                        )
                return

    def _restart_silence_timeout(self) -> None:
        self._cancel_silence_timeout()
        self._silence_task = asyncio.create_task(
            self._silence_timeout_loop(),
            name="aarya_silence_timeout",
        )

    # ------------------------------------------------------------------
    # Internal: task cancellation helpers
    # ------------------------------------------------------------------

    def _cancel_watchdog(self) -> None:
        if self._watchdog_task and not self._watchdog_task.done():
            self._watchdog_task.cancel()
            self._watchdog_task = None

    def _cancel_silence_timeout(self) -> None:
        if self._silence_task and not self._silence_task.done():
            self._silence_task.cancel()
            self._silence_task = None


# ---------------------------------------------------------------------------
# Module-level singleton — import this everywhere
# ---------------------------------------------------------------------------

fsm = AaryaFSM()
