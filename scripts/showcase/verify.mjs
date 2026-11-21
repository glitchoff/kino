// Verify the showcase DB: save a line, delete it, toggle a pick, render a take.
const B = "http://localhost:4100";
const j = (r) => r.json();

let r = await fetch(B + "/api/lines", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ text: "Delete me please" }),
});
let d = await j(r);
const added = d.lines.find((l) => l.text === "Delete me please");
console.log("save line -> id", added?.id, "| total", d.lines.length);

r = await fetch(B + "/api/lines/" + added.id, { method: "DELETE" });
d = await j(r);
console.log("delete line -> total", d.lines.length, "| gone:", !d.lines.some((l) => l.id === added.id));

r = await fetch(B + "/api/picks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ engine: "kokoro", voice: "af_bella", text: "toggle test" }),
});
d = await j(r);
const on = d.picks.length;
r = await fetch(B + "/api/picks", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ engine: "kokoro", voice: "af_bella", text: "toggle test" }),
});
d = await j(r);
console.log("pick toggle -> on:", on, "off:", d.picks.length);

// A render records a take and returns its id in a header.
r = await fetch(B + "/api/say?engine=kokoro&voice=af_bella&text=" + encodeURIComponent("take test"));
const buf = new Uint8Array(await r.arrayBuffer());
console.log("say ->", r.status, buf.length, "bytes | take", r.headers.get("x-kino-take"), "| render", r.headers.get("x-kino-render-ms"), "ms");
