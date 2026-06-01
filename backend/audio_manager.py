# audio_manager.py — Single-Audio Instance Lock (SAIL)

import subprocess
import asyncio
import logging
import os
import sys
import ctypes
import tempfile
import threading
from typing import Optional
from shutil import which

class SingleAudioInstanceLock:
    """
    Enforces exactly one active audio playback at all times.
    Enforces SAIL protocol: SIGTERM -> SIGKILL escalation on subprocesses
    and Close commands on Win32 MCI fallback player.
    """

    GRACEFUL_TIMEOUT_MS = 150    # SIGTERM window before escalation to SIGKILL

    def __init__(self):
        self._active_proc: Optional[subprocess.Popen] = None
        self._lock = asyncio.Lock()
        self._win32_playing = False
        self._temp_files = []

        # Win32 MCI API setups
        if sys.platform == "win32":
            self._mci_send_string = ctypes.windll.winmm.mciSendStringW
            self._kernel32 = ctypes.windll.kernel32
        else:
            self._mci_send_string = None

    def _mci_send(self, command: str) -> int:
        if self._mci_send_string:
            return self._mci_send_string(command, 0, 0, 0)
        return -1

    def _get_short_path_name(self, long_name: str) -> str:
        if sys.platform != "win32":
            return long_name
        try:
            buf = ctypes.create_unicode_buffer(512)
            self._kernel32.GetShortPathNameW(long_name, buf, 512)
            return buf.value
        except Exception:
            return long_name

    async def _terminate_active(self):
        """
        Terminates currently active playback (subprocess or Win32 MCI session)
        and clears out any active locks.
        """
        # 1. Close MCI playback on Windows if active
        if sys.platform == "win32" and self._win32_playing:
            try:
                logging.info("[SAIL] Terminating active Win32 MCI playback session.")
                self._mci_send("Stop theMP3")
                self._mci_send("Close theMP3")
                self._win32_playing = False
            except Exception as e:
                logging.error(f"[SAIL] Win32 MCI termination error: {e}")

        # 2. Terminate active Popen subprocesses
        if self._active_proc is not None:
            proc = self._active_proc
            self._active_proc = None

            if proc.poll() is None:
                logging.info(f"[SAIL] Terminating active audio subprocess PID {proc.pid}")
                try:
                    proc.terminate()  # SIGTERM
                    await asyncio.sleep(self.GRACEFUL_TIMEOUT_MS / 1000.0)
                    
                    if proc.poll() is None:
                        logging.warning(f"[SAIL] SIGTERM timed out for PID {proc.pid}. Escalating to SIGKILL.")
                        proc.kill()  # SIGKILL
                        proc.wait()
                    logging.info(f"[SAIL] Subprocess PID {proc.pid} terminated cleanly.")
                except Exception as e:
                    logging.error(f"[SAIL] Subprocess termination error: {e}")

        # 3. Clean up temporary files
        for temp_file in list(self._temp_files):
            if os.path.exists(temp_file):
                try:
                    os.unlink(temp_file)
                    self._temp_files.remove(temp_file)
                except Exception:
                    pass

    async def play_audio(self, text: str, voice: str, rate: str, pitch: str) -> Optional[int]:
        """
        Synthesizes and plays audio dynamically. Enforces SAIL.
        Determines whether to use native win32 MCI or mpv command pipeline based on path availability.
        """
        async with self._lock:
            # Enforce SAIL: Terminate any running audio
            await self._terminate_active()

            # Check if mpv is available
            use_mpv = which("mpv") is not None

            if use_mpv:
                # ── Pipeline Option: edge-tts piped to mpv ──
                logging.info("[SAIL] mpv player detected. Spawning edge-tts | mpv pipeline subprocess.")
                try:
                    # Escape text for standard edge-tts text param
                    # Spawn edge-tts and pipe its stdout directly to mpv stdin
                    edge_cmd = ["edge-tts", "--voice", voice, "--rate", rate, "--pitch", pitch, "--text", text, "--write-media", "-"]
                    mpv_cmd = ["mpv", "--no-video", "-"]

                    proc_edge = subprocess.Popen(edge_cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
                    proc_mpv = subprocess.Popen(mpv_cmd, stdin=proc_edge.stdout, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    
                    self._active_proc = proc_mpv
                    logging.info(f"[SAIL] Subprocess active. mpv PID: {proc_mpv.pid}")
                    return proc_mpv.pid
                except Exception as e:
                    logging.error(f"[SAIL] Pipeline playback failed: {e}. Falling back to Win32 MCI.")
            
            # ── Fallback Option: edge-tts write-file and Play via Win32 MCI ──
            if sys.platform == "win32":
                logging.info("[SAIL] mpv missing. Utilizing native Win32 MCI asynchronous audio player.")
                try:
                    # 1. Synthesize edge-tts directly to temporary MP3
                    temp_fd, temp_path = tempfile.mkstemp(suffix=".mp3")
                    os.close(temp_fd) # Close file descriptor so edge-tts can write to it
                    self._temp_files.append(temp_path)

                    edge_cmd = ["edge-tts", "--voice", voice, "--rate", rate, "--pitch", pitch, "--text", text, f"--write-media={temp_path}"]
                    proc = subprocess.Popen(edge_cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    
                    # Wait for synthesis to complete
                    proc.wait()
                    
                    if not os.path.exists(temp_path) or os.path.getsize(temp_path) == 0:
                        logging.error("[SAIL] edge-tts synthesis failed (empty temporary file).")
                        return None

                    # 2. Retrieve short shortname format path
                    short_path = self._get_short_path_name(temp_path)

                    # 3. Play asynchronously in the background via MCI
                    self._mci_send("Close All")
                    self._mci_send(f'Open "{short_path}" Type MPEGVideo Alias theMP3')
                    self._mci_send("Play theMP3")
                    
                    self._win32_playing = True
                    logging.info(f"[SAIL] MCI async playback active: {short_path}")
                    return 9999 # Return simulated process ID for success
                except Exception as e:
                    logging.error(f"[SAIL] Win32 MCI fallback playback failed: {e}")
            else:
                logging.error("[SAIL] No supported media player found on this platform.")
            
            return None

    async def stop_all(self):
        """Emergency stop endpoint."""
        async with self._lock:
            await self._terminate_active()

    def stop_all_sync(self):
        """Synchronous emergency stop."""
        if sys.platform == "win32" and self._win32_playing:
            try:
                self._mci_send("Stop theMP3")
                self._mci_send("Close theMP3")
                self._win32_playing = False
            except Exception:
                pass
        if self._active_proc is not None:
            proc = self._active_proc
            self._active_proc = None
            if proc.poll() is None:
                try:
                    proc.terminate()
                    proc.wait(timeout=0.15)
                except Exception:
                    try:
                        proc.kill()
                        proc.wait()
                    except Exception:
                        pass
        for temp_file in list(self._temp_files):
            if os.path.exists(temp_file):
                try:
                    os.unlink(temp_file)
                    self._temp_files.remove(temp_file)
                except Exception:
                    pass

# Global SAIL singleton instance
sail = SingleAudioInstanceLock()
