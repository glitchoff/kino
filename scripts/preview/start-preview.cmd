@echo off
REM Start the chapter preview server.
REM
REM Serves the 70-scene chapter at http://localhost:8000 by building a 360p
REM proxy once, then reading frames from an in-memory window.
REM
REM Leave this window open; closing it stops the server.
REM
REM Rebuild first if src/ changed:  pnpm build
cd /d "D:\Projects\Misc\kino"
echo Chapter preview on http://localhost:8000
npx tsx scripts/preview/chapter.ts
pause
