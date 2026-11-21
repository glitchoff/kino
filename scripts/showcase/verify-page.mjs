// Parse the served page's inline script before claiming it works.
//
// A template literal in showcase-page.ts turns \n into a real newline, which
// silently broke every line of the page's script and left both dropdowns empty.
// Checking that the markup contains an element is not the same as checking the
// script runs, so this parses it and then executes it against a small DOM shim.
import vm from "node:vm";

const BASE = "http://localhost:4100";

const html = await (await fetch(BASE + "/")).text();
const start = html.indexOf("<script>") + 8;
const end = html.lastIndexOf("</script>");
if (start < 8 || end < 0) {
  console.log("FAIL: no inline script found");
  process.exit(1);
}
const code = html.slice(start, end);

// 1. Does it parse at all?
try {
  new vm.Script(code, { filename: "page.js" });
  console.log("parse: ok");
} catch (e) {
  console.log("parse: FAIL —", e.message);
  console.log(e.stack.split("\n").slice(0, 4).join("\n"));
  process.exit(1);
}

// 2. Does it run, and does it fill the selectors?
const els = new Map();
function makeEl(id) {
  return {
    id,
    value: "",
    textContent: "",
    innerHTML: "",
    dataset: {},
    children: [],
    style: {},
    classList: { add() {}, remove() {}, toggle() {} },
    appendChild(c) { this.children.push(c); return c; },
    append(...c) { this.children.push(...c); },
    querySelector() { return { innerHTML: "" }; },
    addEventListener() {},
    setAttribute() {},
    focus() {},
    onclick: null,
    onchange: null,
  };
}
const get = (id) => {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
};

const sandbox = {
  document: {
    getElementById: get,
    createElement: () => makeEl(""),
  },
  performance: { now: () => Date.now() },
  Audio: class {
    constructor() { this.src = ""; }
    addEventListener() {}
    play() { return Promise.resolve(); }
    pause() {}
  },
  fetch: () => Promise.resolve({ json: () => Promise.resolve({}) }),
  setTimeout,
  console,
};

// A real <select> takes the first option's value when one is appended to an
// empty select. The shim has to do the same, or currentEngine() finds nothing
// and every call that follows throws — which looks like a page bug but is not.
const origAppendChild = makeEl("").appendChild;
for (const id of ["engine", "voice"]) {
  const el = get(id);
  el.appendChild = function (child) {
    this.children.push(child);
    if (!this.value) this.value = child.value;
    return child;
  };
}
try {
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);
  console.log("run: ok");
} catch (e) {
  console.log("run: FAIL —", e.message);
  process.exit(1);
}

const engineOpts = get("engine").children.length;
const voiceOpts = get("voice").children.length;
console.log("model options:", engineOpts);
console.log("voice options:", voiceOpts);

// 3. The catalog should list the engines we expect.
const cat = await (await fetch(BASE + "/api/catalog")).json();
console.log("engines:", cat.engines.map((e) => `${e.id}(${e.voices.length})`).join(", "));

const ok = engineOpts > 0 && voiceOpts > 0;
console.log(ok ? "ALL OK" : "FAIL: selectors empty");
process.exit(ok ? 0 : 1);
