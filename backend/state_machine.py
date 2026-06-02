# state_machine.py — AARYA FSM Controller (v2.4.0)
from enum import IntEnum
import asyncio
import logging
import os
import json
import time
import ctypes

class AARYAState(IntEnum):
    DORMANT = 0       # STATE 0: Silent passive monitor
    CONFIRM = 1       # STATE 1: First wake response (Yes sir, I am listening)
    ACTIVE = 2        # STATE 2: Active query processing loop

class AARYAStateMachine:
    """
    Strict FSM controller matching AARYA PRD v2.4.0. Thread-safe via asyncio.Lock.
    """
    DEFAULT_ACTIVATION = "Yes sir, I am listening."

    def __init__(self):
        self._lock = asyncio.Lock()
        self._state = AARYAState.DORMANT
        self._activation_fired = False
        self._cache_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "state_cache.json")
        self._cached_wav = None
        
        # Load cache synchronous during boot
        self._initialize_from_cache()
        # Pre-cache greeting WAV
        self._pre_cache_greetings()

    def _get_os_boot_time(self) -> float:
        try:
            ms_since_boot = ctypes.windll.kernel32.GetTickCount64()
            return time.time() - (ms_since_boot / 1000.0)
        except Exception:
            return 0.0

    def _initialize_from_cache(self):
        boot_time = self._get_os_boot_time()
        if os.path.exists(self._cache_file):
            try:
                with open(self._cache_file, "r") as f:
                    data = json.load(f)
                # If cached boot time matches within 10s, recover session
                if abs(data.get("boot_time", 0.0) - boot_time) < 10.0:
                    self._state = AARYAState(data.get("state", 0))
                    self._activation_fired = data.get("greeting_played", False)
                    logging.info(f"[FSM] Recovered state {self._state.name} from session cache.")
                    return
            except Exception as e:
                logging.error(f"[FSM] Failed to load session cache: {e}")
        
        # Fresh boot session
        self._state = AARYAState.DORMANT
        self._activation_fired = False
        self._save_to_cache()
        logging.info("[FSM] Initialized in STATE 0: DORMANT")

    def _save_to_cache(self):
        try:
            boot_time = self._get_os_boot_time()
            with open(self._cache_file, "w") as f:
                json.dump({
                    "boot_time": boot_time,
                    "state": int(self._state),
                    "greeting_played": self._activation_fired
                }, f)
        except Exception as e:
            logging.error(f"[FSM] Failed to write session cache: {e}")

    def _pre_cache_greetings(self):
        try:
            assets_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "assets")
            wav_path = os.path.join(assets_dir, "confirm_yes_sir.wav")
            if not os.path.exists(wav_path):
                wav_path = os.path.join(assets_dir, "fallback_confirm.wav")
            
            if os.path.exists(wav_path):
                with open(wav_path, "rb") as f:
                    self._cached_wav = f.read()
                logging.info(f"[FSM] Pre-cached greeting WAV: {wav_path} ({len(self._cached_wav)} bytes)")
            else:
                logging.warning(f"[FSM] Greeting WAV not found at {wav_path}")
        except Exception as e:
            logging.error(f"[FSM] Failed to pre-cache greeting WAV: {e}")

    def get_cached_greeting_wav(self) -> bytes:
        return self._cached_wav

    async def get_state(self) -> AARYAState:
        async with self._lock:
            return self._state

    async def get_greeting_played(self) -> bool:
        async with self._lock:
            return self._activation_fired

    async def on_wake_word_detected(self) -> str:
        """
        Called by wake-word engine. Validates state, fires STATE 1,
        returns hardcoded activation string, then advances to STATE 2.
        """
        async with self._lock:
            if self._state != AARYAState.DORMANT:
                # Already active — skip reactivation
                return None

            if self._activation_fired:
                return None

            # Transition to STATE 1
            self._state = AARYAState.CONFIRM
            self._activation_fired = True
            self._save_to_cache()
            logging.info("[FSM] Transitioned to STATE 1: CONFIRM")
            return self.DEFAULT_ACTIVATION

    async def on_activation_complete(self):
        """Called after activation greeting delivery finishes."""
        async with self._lock:
            if self._state == AARYAState.CONFIRM:
                self._state = AARYAState.ACTIVE
                self._save_to_cache()
                logging.info("[FSM] Transitioned to STATE 2: ACTIVE")

    async def on_query_received(self, query: str) -> bool:
        """
        Validates that a query can be processed.
        In State 0, a query triggers activation first!
        In State 1, query is strictly rejected.
        """
        async with self._lock:
            if self._state == AARYAState.DORMANT:
                # DORMANT trigger -> activate and play greeting
                self._state = AARYAState.CONFIRM
                self._activation_fired = True
                self._save_to_cache()
                logging.info("[FSM] First-wake query triggers STATE 1: CONFIRM")
                return False  # Blocks direct LLM execution to play greeting
            elif self._state == AARYAState.CONFIRM:
                return False  # Blocks during greeting delivery
            return True  # STATE 2 allows direct dialogue loop

    async def force_state(self, state: AARYAState, greeting_played: bool = None):
        """Forcefully changes the state machine state."""
        async with self._lock:
            self._state = state
            if greeting_played is not None:
                self._activation_fired = greeting_played
            self._save_to_cache()
            logging.info(f"[FSM] Forcefully set state to {self._state.name}")

    async def reset(self):
        """Hard reset to STATE 0. Called on session end or crash recovery."""
        async with self._lock:
            self._state = AARYAState.DORMANT
            self._activation_fired = False
            self._save_to_cache()
            logging.info("[FSM] HARD RESET → STATE 0: DORMANT")

# Global singleton FSM instance
fsm = AARYAStateMachine()
