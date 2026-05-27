@echo off
set PYTHONUTF8=1

cd /d D:\Aarya\backend

:: Required activation path
call ..\.venv312\Scripts\activate 2>nul

:: Robust fallback activation paths
if not defined VIRTUAL_ENV (
    if exist ".venv312\Scripts\activate.bat" (
        call ".venv312\Scripts\activate.bat"
    ) else if exist "venv\Scripts\activate.bat" (
        call "venv\Scripts\activate.bat"
    ) else if exist "..\.venv\Scripts\activate.bat" (
        call "..\.venv\Scripts\activate.bat"
    )
)

:: Check if port 8000 is already LISTENING to prevent duplicate launches
netstat -ano | findstr :8000 | findstr LISTENING >nul
if errorlevel 1 (
    echo [AARYA] Starting backend on port 8000...
    start /min cmd /c "set PYTHONUTF8=1&& python -m uvicorn main:app --host 127.0.0.1 --port 8000"
) else (
    echo [AARYA] Backend is already running on port 8000.
)
