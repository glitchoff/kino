// Verify the caption fixes by measurement.
//
//   npx tsx check-captions.ts
//
// Three bugs are checked, all of which rendered a valid video while looking
// wrong:
//
//   1. `style: "word"` words overlapped. Each lasted `span + hold`, so two were
//      on screen at once and — being centred at the same x/y — drew as stacked
//      glyphs.
//   2. Lines ran off both edges. Wrapping used a character-class estimate that
//      prices every lowercase letter at 0.52em; Anton is ~0.38em, so the line
//      was reported as fitting when it did not.
//   3. A word wider than the frame was clipped instead of shrunk.
//
// Each is checked against the built elements / normalized output, not a render.

import { captions, normalizeElement, bundledAsset } from "./src/index.js";
import { evenTimings } from "./src/captions/index.js";
import { measureText } from "./src/measure/index.js";

let failed = 0;
const fail = (msg: string) => { console.log(`  FAIL: ${msg}`); failed++; };

const LINE = "Pallet Town. Two hills, a few houses, and nothing to do.";
const W = 720;
const H = 1280;

// --- 1. no overlapping words ------------------------------------------------
console.log("word style: no two words on screen at once");
{
  const timings = evenTimings(LINE, 3.7);
  const els = captions({ text: LINE, seconds: 3.7 }, { preset: "shout" });
  const spans = els.map((e: any) => {
    const start = Number(e.startAt);
    const dur = Number(e.duration);
    return { text: e.content, start, end: start + dur };
  });
  let overlaps = 0;
  for (let i = 0; i < spans.length - 1; i++) {
    if (spans[i].end > spans[i + 1].start + 1e-6) {
      overlaps++;
      console.log(`    overlap: "${spans[i].text}" ends ${spans[i].end.toFixed(2)} but "${spans[i + 1].text}" starts ${spans[i + 1].start.toFixed(2)}`);
    }
  }
  console.log(`    ${spans.length} words, ${overlaps} overlaps`);
  if (overlaps > 0) fail("words overlap in time");
  if (spans.length !== timings.length) fail(`expected ${timings.length} elements, got ${spans.length}`);

  // And no gaps: every word should end exactly where the next begins.
  const gaps = spans.slice(0, -1).filter((s, i) => s.end < spans[i + 1].start - 1e-6).length;
  if (gaps > 0) fail(`${gaps} gap(s) where the frame would go blank`);
}

// --- 2. nothing wider than the frame ---------------------------------------
console.log("\nlong lines wrap inside the frame");
for (const preset of ["shout", "plain", "shout-band"] as const) {
  const els = captions({ text: LINE, seconds: 3.7 }, { preset });
  const fontFile = (els[0] as any)?.fontFile ?? bundledAsset("Inter-Regular.ttf");
  const norm = normalizeElement(els[0] as any, {
    canvasWidth: W, canvasHeight: H, sceneDuration: 4, index: 0,
  } as never) as any;

  const maxW = norm.maxWidth ?? 0;
  const widestLine = String(norm.content)
    .split("\n")
    .reduce((a, b) => (measureText(b, { fontSize: norm.fontSize, fontFile }).width >
                       measureText(a, { fontSize: norm.fontSize, fontFile }).width ? b : a), "");

  const px = measureText(widestLine, { fontSize: norm.fontSize, fontFile }).width;
  const fits = px <= W;
  console.log(`  ${preset.padEnd(11)} font ${String(norm.fontSize).padStart(4)}px  maxWidth ${String(maxW).padStart(4)}  widest ${px.toFixed(0)}px  ${fits ? "fits" : "OVERFLOWS"}`);
  if (!fits) fail(`${preset}: widest line ${px.toFixed(0)}px exceeds ${W}px frame`);
  if (!maxW) fail(`${preset}: no maxWidth, so nothing constrains the wrap`);
}

// --- 3. a single huge word shrinks instead of clipping ----------------------
console.log("\nan unbreakable word shrinks to fit");
{
  const els = captions({ text: "ELECTRIC", seconds: 1.2 }, { preset: "shout" });
  const norm = normalizeElement(els[0] as any, {
    canvasWidth: W, canvasHeight: H, sceneDuration: 2, index: 0,
  } as never) as any;
  const fontFile = (els[0] as any)?.fontFile ?? bundledAsset("Anton-Regular.ttf");
  const px = measureText(String(norm.content), { fontSize: norm.fontSize, fontFile }).width;
  console.log(`  ELECTRIC at ${norm.fontSize}px = ${px.toFixed(0)}px (frame ${W}px)`);
  if (px > W) fail(`still ${px.toFixed(0)}px wide`);
}

console.log(failed === 0 ? "\nPASS" : `\n${failed} FAILURE(S)`);
process.exit(failed === 0 ? 0 : 1);
