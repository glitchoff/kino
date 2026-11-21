import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Derives a video-only ffmpeg invocation from a compiled manifest.
 *
 * ## Why this is needed
 *
 * A compiled composition ends with two maps — `-map [bg_concat]` (video) and
 * `-map [a_mix_final]` (audio) — followed by encoder flags. To stream raw frames
 * for a live preview, only the video pad may be mapped.
 *
 * Dropping the audio `-map` is not enough: ffmpeg validates the whole
 * filtergraph and refuses with
 *
 *     Filter amix:default has an unconnected output
 *
 * The audio chains are still in the script, and every filter output must be
 * consumed. So the graph is rewritten to keep only the chains reachable from the
 * video pad. On the 70-scene chapter that is 1,855 of 2,074 chains — the audio
 * mix, the per-line narration inputs and their resampling all go.
 *
 * ## What it returns
 *
 * Arguments ready for `ffmpeg … -f rawvideo -pix_fmt rgba -`, with the rewritten
 * graph written beside the original and referenced by a relative filename (the
 * caller runs ffmpeg from the extracted directory).
 */
export interface VideoOnlyArgs {
  /** Args up to and including `-map [videoPad]`, no output path. */
  args: string[];
  /** Name of the rewritten filtergraph file, relative to the extract dir. */
  script: string;
  /** The video pad that was mapped, for diagnostics. */
  videoPad: string;
  /** Chains kept / total, for diagnostics. */
  chains: { kept: number; total: number };
}

export function videoOnlyArgs(manifestArgs: string[], extractDir: string): VideoOnlyArgs {
  // Compiled args end with the output path; everything before is inputs and
  // the filtergraph.
  const all = manifestArgs.slice(0, -1);

  const mapAt = all.indexOf("-map");
  if (mapAt < 0) throw new Error("[kino] compiled args have no -map; cannot derive a video pad");
  const videoPad = all[mapAt + 1];
  if (!videoPad?.startsWith("[")) {
    throw new Error(`[kino] unexpected -map value: ${videoPad}`);
  }

  const scriptAt = all.indexOf("-filter_complex_script");
  if (scriptAt < 0) {
    // No external script: the graph is inline, so the audio map can simply be
    // dropped along with the encoder flags.
    return {
      args: [...all.slice(0, mapAt), "-map", videoPad],
      script: "",
      videoPad,
      chains: { kept: 0, total: 0 },
    };
  }

  const scriptName = all[scriptAt + 1];
  const graph = readFileSync(join(extractDir, scriptName), "utf8");
  const chains = graph.split(";").map((s) => s.trim()).filter(Boolean);

  // Pads that ffmpeg itself provides: lavfi sources, image inputs, audio files.
  // Every `-i` adds one numbered input (`[0:v]`, `[1:v]`, ...) and the compiler
  // also names some sources directly (`bg_scene_0`, `ka_base`). A chain that
  // consumes one of these needs no producer, so they must not be treated as
  // missing — that mistake dropped 141 pads still in use and made ffmpeg fail
  // with "Error initializing complex filters: Invalid argument".
  const sourcePads = new Set<string>();
  for (let i = 0; i < all.length; i++) {
    if (all[i] === "-i") {
      const n = Math.floor(sourcePads.size / 2);
      sourcePads.add(`${n}:v`);
      sourcePads.add(`${n}:a`);
    }
  }

  // Any pad a chain consumes but no chain produces is a source by definition —
  // ffmpeg resolves it against an input. Deriving this from the graph itself is
  // more robust than guessing which names the compiler invents.
  const produced = new Set<string>();
  for (const chain of chains) {
    const pads = [...chain.matchAll(/\[([a-z0-9_:]+)\]/gi)].map((m) => m[1]);
    if (pads.length) produced.add(pads[pads.length - 1]);
  }
  for (const chain of chains) {
    const pads = [...chain.matchAll(/\[([a-z0-9_:]+)\]/gi)].map((m) => m[1]);
    for (const p of pads.slice(0, -1)) {
      if (!produced.has(p)) sourcePads.add(p);
    }
  }

  // Walk backwards from the video pad, keeping every chain whose *output* feeds
  // something already kept.
  //
  // An output pad is the bracket group immediately before the chain's filters,
  // or at its end — not simply the last bracket in the string, because a chain
  // like `[a][b]overlay[out]` has two inputs and one output, while
  // `[a]scale=…,drawtext=…[out]` has one input. The rule that works for both:
  // the output is the last bracket, and everything before it is an input.
  const outputOf = (chain: string): string | undefined => {
    const pads = [...chain.matchAll(/\[([a-z0-9_:]+)\]/gi)].map((m) => m[1]);
    return pads.length ? pads[pads.length - 1] : undefined;
  };
  const inputsOf = (chain: string): string[] => {
    const pads = [...chain.matchAll(/\[([a-z0-9_:]+)\]/gi)].map((m) => m[1]);
    return pads.slice(0, -1);
  };

  const wanted = videoPad.replace(/^\[|\]$/g, "");
  const keep = new Set<string>();
  const queue = [wanted];
  const seen = new Set<string>();

  while (queue.length) {
    const pad = queue.shift()!;
    if (seen.has(pad)) continue;
    seen.add(pad);

    for (const chain of chains) {
      if (keep.has(chain)) continue;
      if (outputOf(chain) !== pad) continue;
      keep.add(chain);
      for (const input of inputsOf(chain)) {
        // A source pad needs no producer; queueing it would spin forever.
        if (sourcePads.has(input)) continue;
        queue.push(input);
      }
    }
  }

  const videoScriptName = "filtergraph-video.txt";
  writeFileSync(join(extractDir, videoScriptName), chains.filter((c) => keep.has(c)).join(";"), "utf8");

  return {
    args: [
      ...all.slice(0, scriptAt),
      "-filter_complex_script", videoScriptName,
      "-map", videoPad,
    ],
    script: videoScriptName,
    videoPad,
    chains: { kept: keep.size, total: chains.length },
  };
}
