# ask.md — open asks for humans

Questions or actions that need a human. Agents read this; humans answer it.
Mark an item `answered` or delete it once resolved. Keep entries short.

Format:

```
### <date> — <short title>
**Ask:** what is needed
**Why:** why an agent cannot do it
**Status:** open | answered | dropped
**Answer:** (filled in by the human)
```

---

### 2026-11-06 — Add `workflow` scope to the classic PAT

**Ask:** add the `workflow` scope to the classic GitHub token (Settings → Developer settings → Tokens → check `workflow`).
**Why:** a classic PAT without `workflow` cannot create or update files under `.github/workflows/`.
**Status:** dropped
**Answer:** Not needed — pushes go through `gh auth token` (the Codespaces `ghu_` token), which has `workflow` scope. The classic PAT is unused for this.

---

### 2026-11-06 — Decide on upstreaming the FFmpeg fix

**Ask:** should the `scripts/install-ffmpeg.mjs` fix be opened as a PR to the upstream repository?
**Why:** it affects every Linux install; the change is small and self-contained, but the upstream repo is not ours to push to.
**Status:** answered
**Answer:** Done. Opened as `glitchoff/kino#1` and merged by the maintainer on 2026-11-06 (merge commit `2108a60`). It went up with the whole 16-commit batch, not as a standalone PR.
