// Compare the showcase's voice list with the server's actual catalog.
//
// Pocket treats a voice name it does not recognise as a *path*, which falls
// through to voice cloning — and cloning needs gated weights, so the request
// fails with VOICE_CLONING_UNSUPPORTED rather than "unknown voice". Any name in
// the showcase list that the server does not know produces that error.
const SERVER = [
  "cosette", "marius", "javert", "alba", "jean", "anna", "vera", "fantine",
  "charles", "paul", "eponine", "azelma", "george", "mary", "jane", "michael",
  "eve", "bill_boerst", "peter_yearsley", "stuart_bell", "caro_davy",
  "giovanni", "lola", "juergen", "rafael", "daan", "estelle",
];

const cat = await (await fetch("http://localhost:4100/api/catalog")).json();
const pocket = cat.engines.find((e) => e.id === "pocket");
if (!pocket) {
  console.log("no pocket engine in the catalog");
  process.exit(1);
}

const extra = pocket.voices.filter((v) => !SERVER.includes(v));
const missing = SERVER.filter((v) => !pocket.voices.includes(v));

console.log("showcase voices:", pocket.voices.length, "| server catalog:", SERVER.length);
console.log("in showcase but NOT in server:", extra.length ? extra.join(", ") : "none");
console.log("in server but NOT in showcase:", missing.length ? missing.join(", ") : "none");
