# Goals

Priority order. Update when priorities shift.

## 1. Kino is scripting-first

Compositions are written in TypeScript. JSON remains supported as the legacy /
interop format but is frozen: it accepts the same `KinoComposition` shape and
gets no new authoring features.

- Status: done — see `tickets/001`

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
- Status: done — see `tickets/004`
