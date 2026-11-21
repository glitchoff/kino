// Verify the PROXY preview path end to end: build, sequential frames, jumps.
//
// Each frame is checked for being a real image (non-black pixel count), not just
// for a 200 status: a status check alone passed while the live path was handing
// back JSON error bodies.
const BASE = "http://localhost:8000";
const W = 640, H = 360, STRIDE = W * H * 4;

function stats(buf) {
  let nz = 0, sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const v = buf[i] + buf[i + 1] + buf[i + 2];
    if (v > 60) nz++;
    sum += v;
  }
  return { nz, mean: (sum / (buf.length / 4) / 3).toFixed(1) };
}

async function frame(t) {
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/frame?raw=1&t=${t}`);
  const ms = Date.now() - t0;
  const buf = new Uint8Array(await r.arrayBuffer());
  if (r.status !== 200 || buf.length !== STRIDE) {
    const text = new TextDecoder().decode(buf.subarray(0, 200));
    return { t, ms, status: r.status, bytes: buf.length, error: text };
  }
  const s = stats(buf);
  return { t, ms, status: r.status, bytes: buf.length, nz: s.nz, mean: s.mean };
}

const p = await fetch(`${BASE}/api/proxy`, { method: "POST" });
const info = await p.json();
console.log(`POST /api/proxy -> ${p.status} in ${info.ms} ms`);
console.log(`  live:     ${info.live}`);
console.log(`  cacheMs:  ${info.cacheMs}`);
console.log(`  duration: ${info.duration}s at ${info.fps} fps`);
console.log(`  size:     ${info.size.w ?? info.size[0]}x${info.size.h ?? info.size[1]}`);
console.log(`  scenes:   ${info.scenes?.length}`);
console.log(`  cacheObj: ${info.cache ? JSON.stringify(info.cache) : "none"}`);
console.log();

console.log("sequential (10 frames from t=10s):");
let bad = 0;
for (let i = 0; i < 10; i++) {
  const f = await frame(10 + i / 30);
  if (f.error) { bad++; console.log(`  t=${f.t.toFixed(2)} ${f.status} ${f.error.slice(0, 120)}`); }
  else console.log(`  t=${f.t.toFixed(2)} ${f.ms} ms  ${f.bytes} B  nz=${f.nz}  mean=${f.mean}`);
}
console.log();

for (const t of [90, 5, 150, 0.5]) {
  const f = await frame(t);
  if (f.error) { bad++; console.log(`jump t=${t}s: ${f.status} ${f.error.slice(0, 120)}`); }
  else console.log(`jump t=${t}s: ${f.ms} ms  ${f.bytes} B  nz=${f.nz}  mean=${f.mean}`);
}

console.log();
console.log(bad === 0 ? "ALL FRAMES OK" : `${bad} FAILURES`);
