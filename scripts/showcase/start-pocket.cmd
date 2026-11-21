@echo off
REM Start Pocket TTS for the kino voice showcase.
REM
REM Port 8200, not the default 8000 — the preview server owns 8000.
REM Leave this window open; closing it stops the server.
REM
REM First run downloads the model (~seconds to a minute). Later runs start fast.
cd /d "D:\Projects\Misc\paper-ghost"
echo Pocket TTS on http://localhost:8200
".venv-pocket\Scripts\python.exe" -m pocket_tts serve --port 8200
pause
