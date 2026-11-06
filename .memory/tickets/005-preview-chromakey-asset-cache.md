# 005 — Preview renders, chroma key, asset cache

Status: done (2026-11-06)

Three render-path features added on top of the scripting-first work.

## Shipped

1. **`--preview [height]`** (`preview: boolean | number` on `RenderOptions`)
   - Appends `scale=-2:<h>[vpv]` as the final filter stage and maps `[vpv]`.
   - Encoder defaults to `ultrafast` unless `preset` is given.
   - `true` = 144p (`PREVIEW_DEFAULT_HEIGHT`), a number = explicit height.
   - Only the output stage changes, so the graph a preview shows is the graph
     that renders. `test/preview.test.ts` asserts the full graph is a prefix of
     the preview graph.
   - Measured on `examples/basic.ts` (32s): 18.5s → 10.9s.

2. **Chroma key** (`chromaKey` on `ImageElement` / `VideoElement`)
   - `chromaKey: true` keys green with tight defaults; an object tunes
     `color`, `similarity` (0.01), `blend` (0) and `despill`.
   - Emits ffmpeg `chromakey`, optional `despill`.
   - Keyed layers stay `format=rgba` from the scale filter to the overlay —
     the video path must not force `yuv420p` or the alpha is lost.
   - Verified visually: green screen removed, subject composited over a
     different scene background.

3. **Remote asset cache** (`assetCache` / `assetCacheDir`)
   - SHA-256 (first 32 hex chars) of the URL is the cache key; `<key>.bin` +
     `<key>.json` per asset.
   - Cache lives in `.kino-cache/` in the cwd, falling back to
     `~/.cache/kino/assets` when the cwd is not writable.
   - Assets download in parallel; one URL referenced by several elements is
     fetched once (in-flight map).
   - Writes go to a temp name then rename, so a killed render never leaves a
     truncated entry.
   - A cache hit copies the file into the staging dir — ffmpeg needs the file
     present, not just the metadata.
   - `pruneAssetCache(dir, urls)` drops entries no longer referenced.

## Bugs found while building this

- `buildTransitionPipeline` returns an already-bracketed pad (`[bg_concat]`),
  so the preview stage produced `[[bg_concat]]`. Normalised before use.
- `-map` needs bracket syntax: `-map vpv` is parsed as a *file index* and fails
  with `Failed to set value 'vpv' for option 'map'`. Must be `-map [vpv]`.
- The first cache implementation reported a hit without staging the file, so
  ffmpeg failed with `No such file or directory: remote-1.jpg`.

## Known limits

- Preview only speeds up encoding. Asset download and filter work dominate on
  small compositions, so warm re-renders are barely faster. The real win needs
  scene-level rendering (`--scene <id>`).
- Cache is keyed by URL only — a URL serving new bytes is not invalidated.
- Test for the cache is unit-level (key + prune). The download path is verified
  by rendering, not by a test, because `prestageRemoteAssets` uses `spawnSync`
  and would deadlock against an in-process HTTP fixture.

## Tests

`test/preview.test.ts` (5), `test/chromakey.test.ts` (9),
`test/asset-cache.test.ts` (2). Suite: 85 passing.
