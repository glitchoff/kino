# Long filtergraphs: the 32,767-character limit

A composition with enough elements compiles to a filtergraph too long to pass as
a command-line argument. On Windows that fails outright; the failure mode is
confusing, and the guard that is supposed to prevent it does not fire on Windows.

## The limit

`CreateProcess` stores a command line in a 16-bit length field, so **32,767
characters is the hard ceiling on Windows** — not a PowerShell limit, and not
something a longer shell command can work around. `spawn()` passes the argv
through that API, so kino inherits it.

On POSIX the limit is `ARG_MAX`, typically 2 MB, shared with the environment.

## What kino does today

`src/pipeline/compile.ts` writes the graph to `filtergraph.txt` in the staging
dir and passes `-filter_complex_script` instead of `-filter_complex`:

```ts
const FILTERGRAPH_ARG_LIMIT = 100_000;
const FILTERGRAPH_SCRIPT_NAME = "filtergraph.txt";

if (filtergraphStr.length > FILTERGRAPH_ARG_LIMIT) {
  writeFileSync(join(stagingDir, FILTERGRAPH_SCRIPT_NAME), filtergraphStr, "utf8");
  args.push("-filter_complex_script", FILTERGRAPH_SCRIPT_NAME);
} else {
  args.push("-filter_complex", filtergraphStr);
}
```

The script file is packed into the `.kino` artifact and extracted at render time,
and ffmpeg runs with that directory as its cwd, so the basename is all it needs.

## The bug: the threshold is above the Windows ceiling

`FILTERGRAPH_ARG_LIMIT` is **100,000**. The code comment says the OS limit is
"typically 2 MB" — true on Linux, **wrong on Windows**, where it is 32,767.

So any graph between 32,767 and 100,000 characters takes the
`-filter_complex` branch and dies at spawn:

```
[kino] auto: using hardware encoder 'h264_nvenc'
[kino] Error: spawn ENAMETOOLONG
```

### Evidence

A 7-beat, 19-page manga composition (52 image elements, 29 audio tracks, 93s):

| Render | `--dry-run` output | Result |
| --- | --- | --- |
| whole composition | 36,751 chars | `spawn ENAMETOOLONG` |
| one scene (`--scene beat-06`) | 7,844 chars | renders fine |

36,751 sits in the dead zone: too long for Windows, too short to trip the
script-file branch. The workaround was rendering scene by scene and concatenating
with a separate `join` script — pure overhead the engine should not impose.

The comment above the constant only anticipates E2BIG on POSIX. The Windows case
was never handled.

## The fix

Make the threshold platform-aware, or drop it and always use the script file
when the graph is non-trivial:

```ts
const FILTERGRAPH_ARG_LIMIT = process.platform === "win32" ? 30_000 : 100_000;
```

30,000 leaves headroom for the rest of the argv (input paths, encoder flags,
output path) under the 32,767 ceiling. Always writing the script file above a
small floor is simpler still — ffmpeg reads it identically, and a file on disk
costs nothing.

## Checking a composition before rendering

```bash
npx kino composition.ts --dry-run | wc -c     # POSIX
npx kino composition.ts --dry-run | Measure-Object -Character   # PowerShell
```

If the count approaches 30,000 on Windows, expect the failure unless the fix
above is in place.

## Non-fixes

- **`--preview`** shortens the output, not the filtergraph. No help.
- **Removing `motionBlur`** reduces the graph but not reliably below the limit;
  motion blur multiplies filters per element.
- **A longer shell command** cannot help: the ceiling is in `CreateProcess`, not
  in the shell.
