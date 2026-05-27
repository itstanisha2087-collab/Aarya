@echo off
setlocal enabledelayedexpansion
set PYTHONUTF8=1

title AARYA Desktop AI Assistant — Boot Sequence
echo.
echo ══════════════════════════════════════════════════
echo   AARYA Ambient AI Assistant — Boot Sequence
echo ══════════════════════════════════════════════════
echo.

REM --- 1. Kill any stale processes on required ports ---
echo [AARYA] Checking for stale processes...
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":8000.*LISTENING"') do (
    echo [AARYA] Killing stale process on port 8000 (PID %%a)
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3000.*LISTENING"') do (
    echo [AARYA] Killing stale process on port 3000 (PID %%a)
    taskkill /F /PID %%a >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3001.*LISTENING"') do (
    echo [AARYA] Killing stale process on port 3001 (PID %%a)
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM --- 2. Start FastAPI Backend ---
echo [AARYA] Starting FastAPI backend on port 8000...
cd /d "D:\Aarya\backend"
start "AARYA-Backend" /min "D:\Aarya\.venv312\Scripts\python.exe" -m uvicorn main:app --host 127.0.0.1 --port 8000

REM Wait for backend readiness
echo [AARYA] Waiting for backend...
set /a attempts=0
:wait_backend
set /a attempts+=1
if !attempts! gtr 30 (
    echo [AARYA] WARNING: Backend did not start within 30 seconds. Continuing...
    goto start_frontend
)
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8000/' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    timeout /t 1 /nobreak >nul
    goto wait_backend
)
echo [AARYA] Backend is ONLINE.

REM --- 3. Start Next.js Frontend ---
:start_frontend
echo [AARYA] Starting Next.js dev server on port 3000...
cd /d "D:\Aarya"
start "AARYA-Frontend" /min npm run dev

REM Wait for frontend readiness
echo [AARYA] Waiting for frontend...
set /a attempts=0
:wait_frontend
set /a attempts+=1
if !attempts! gtr 60 (
    echo [AARYA] WARNING: Frontend did not start within 60 seconds. Continuing...
    goto start_electron
)
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/' -TimeoutSec 2 -UseBasicParsing; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if %ERRORLEVEL% neq 0 (
    timeout /t 1 /nobreak >nul
    goto wait_frontend
)
echo [AARYA] Frontend is ONLINE.

REM --- 4. Start Electron Shell ---
:start_electron
echo [AARYA] Launching Electron desktop shell...
cd /d "D:\Aarya"
start "AARYA-Electron" npx electron . --minimized

timeout /t 3 /nobreak >nul

REM --- 5. Start Voice Listener (Interactive Minimized Console) ---
echo [AARYA] Launching ambient voice listener...
cd /d "D:\Aarya"
start "AARYA-Listener" /min cmd /k "D:\Aarya\.venv312\Scripts\python.exe" desktop_listener.py

echo.
echo ══════════════════════════════════════════════════
echo   AARYA is ONLINE. All systems active.
echo ══════════════════════════════════════════════════
echo.
echo   Backend:    http://127.0.0.1:8000
echo   Frontend:   http://127.0.0.1:3000
echo   Electron:   Desktop shell active
echo   Listener:   Ambient mic active
echo.
echo   Say "Hello Aarya" or "Wake up Aarya" to activate.
echo ══════════════════════════════════════════════════
echo.
pause
