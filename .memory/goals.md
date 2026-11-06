# Goals

Priority order. Update when priorities shift.

## 1. Make compositions authorable in code

JSON is good for data, but real videos need loops, variables, computed timings
and shared constants. Ship a small builder API so a composition can be written
in TypeScript with full type inference, and let the CLI consume `.ts`/`.js`
composition modules as well as `.json`.

- Status: in progress — see `tickets/001`
- The builder must produce the same `KinoComposition` object, so JSON and code
  stay interchangeable and nothing downstream changes.

## 2. Keep the render path reliable

- The FFmpeg download must not break installs. Track a rolling branch, not a
  dated autobuild tag that upstream may prune.
- Verify the binary actually has `drawtext` before rendering text.
- Status: fixed — see `tickets/003`

## 3. Fast feedback loops

- Manual CI workflow that renders a chosen example and delivers the MP4 to
  Telegram, so a change can be eyeballed within a minute.
- Cache dependencies and the bundled FFmpeg so repeat runs skip setup.
- Status: done — see `done.md`

## 4. Catch regressions before release

- Run install + FFmpeg verification + tests on push/PR, not only on tags.
- Status: open — see `tickets/004`
