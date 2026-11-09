// Downloads the third-party assets an example needs but does not check in.
//
// Examples that use photos or fonts are kept out of git so the repository does
// not carry tens of megabytes of binary for a demo. This script fetches them
// into examples/assets/ on demand; both the CLI and CI call it before a render
// that needs them.
//
//   node scripts/fetch-example-assets.mjs gk-quiz
//
// Assets are cached: an existing file is left alone, so a second run costs
// nothing. Licences: the photos are Wikimedia Commons files (CC BY-SA or
// public domain) and the fonts are Noto, under the SIL Open Font License 1.1.
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "examples", "assets");

const NOTO = "https://raw.githubusercontent.com/notofonts/notofonts.github.io/main/fonts";

/** Asset sets, keyed by the name a caller asks for. */
const SETS = {
  "gk-quiz": {
    "NotoSansDevanagari-Bold.ttf": `${NOTO}/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Bold.ttf`,
    "NotoSansDevanagari-Regular.ttf": `${NOTO}/NotoSansDevanagari/hinted/ttf/NotoSansDevanagari-Regular.ttf`,
    "NotoSans-Bold.ttf": `${NOTO}/NotoSans/hinted/ttf/NotoSans-Bold.ttf`,
    "NotoSans-Regular.ttf": `${NOTO}/NotoSans/hinted/ttf/NotoSans-Regular.ttf`,
    // Wikimedia Commons. Copper crystals (CC BY-SA 3.0), Gandhi 1931 (public
    // domain), Mysore Rail Museum steam engine (CC BY-SA 4.0).
    "q1-copper.jpg":
      "https://upload.wikimedia.org/wikipedia/commons/d/dc/Copper_crystals.jpg",
    "q2-gandhi.jpg":
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/7/7a/Mahatma-Gandhi%2C_studio%2C_1931.jpg/960px-Mahatma-Gandhi%2C_studio%2C_1931.jpg",
    "q3-train.jpg":
      "https://thumb.wikimedia.org/wikipedia/commons/thumb/0/03/Train_Engine_Mysore_Rail_Museum.JPG/960px-Train_Engine_Mysore_Rail_Museum.JPG",
  },
};

const USER_AGENT = "kino-example-assets/1.0 (+https://github.com/glitchoff/kino)";

async function download(url, dest) {
  const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} → ${res.status} ${res.statusText}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  // A truncated or redirected HTML page would otherwise be cached as if it
  // were the image, and the render would fail much later with a decode error.
  if (bytes.length < 1024) throw new Error(`GET ${url} returned only ${bytes.length} bytes`);

  await new Promise((resolve, reject) => {
    const out = createWriteStream(dest);
    out.on("error", reject);
    out.on("finish", resolve);
    out.end(bytes);
  });
}

const wanted = process.argv.slice(2);
if (!wanted.length) {
  console.error(`Usage: node scripts/fetch-example-assets.mjs <set>\nSets: ${Object.keys(SETS).join(", ")}`);
  process.exit(1);
}

mkdirSync(ASSETS, { recursive: true });

for (const name of wanted) {
  const set = SETS[name];
  if (!set) {
    console.error(`Unknown asset set '${name}'. Sets: ${Object.keys(SETS).join(", ")}`);
    process.exit(1);
  }
  for (const [file, url] of Object.entries(set)) {
    const dest = join(ASSETS, file);
    if (existsSync(dest)) {
      console.log(`have  ${file}`);
      continue;
    }
    process.stdout.write(`fetch ${file} … `);
    await download(url, dest);
    console.log("ok");
  }
}
