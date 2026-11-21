@echo off
REM Start the kino voice showcase (TTS audition page).
REM
REM Needs Pocket TTS running first — see start-pocket.cmd in this folder.
REM Leave this window open; closing it stops the showcase.
REM
REM Rebuild first if src/ changed:  pnpm build
cd /d "D:\Projects\Misc\kino"
echo Voice showcase on http://localhost:4100
npx tsx scripts/showcase/index.ts
pause
