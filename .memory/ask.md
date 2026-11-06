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

### 2026-11-06 — Rotate the credentials used during setup

**Ask:** rotate the GitHub PAT, Telegram bot token, and Pexels API key that were used while wiring up the render workflow. They were shared over a public file host.
**Why:** an agent can revoke/regenerate some of these, but that breaks any other machine still using them, so the call is yours.
**Status:** open
**Answer:**

---

### 2026-11-06 — Add `workflow` scope to the classic PAT

**Ask:** add the `workflow` scope to the classic GitHub token (Settings → Developer settings → Tokens → check `workflow`).
**Why:** a classic PAT without `workflow` cannot create or update files under `.github/workflows/`.
**Status:** open
**Answer:**

---

### 2026-11-06 — Decide on upstreaming the FFmpeg fix

**Ask:** should the `scripts/install-ffmpeg.mjs` fix be opened as a PR to the upstream repository?
**Why:** it affects every Linux install; the change is small and self-contained, but the upstream repo is not ours to push to.
**Status:** open
**Answer:**
