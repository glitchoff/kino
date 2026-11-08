/**
 * `:::preview name="feature-mask" caption="An ellipse mask"` in a docs page
 * becomes an embedded clip on the site.
 *
 * The docs are read in place from `docs/`, so the same files are read in the
 * repo. A raw directive there is one line of plain text, which is a fair price
 * for not keeping two copies of every page.
 *
 * Two things about how this runs are worth knowing, because both are silent
 * when you get them wrong:
 *
 * - **Astro applies Smartypants before remark plugins.** By the time this sees
 *   the line, `"` has become `“`/`”`. Matching only straight quotes finds no
 *   attributes, the directive is passed through as text, and the page shows the
 *   markup instead of a clip. `parseAttrs` accepts both.
 * - **The whole directive usually arrives as one text node**, closing `:::`
 *   included, rather than as separate paragraphs. A multi-line body with blank
 *   lines does split into several nodes, so both shapes are handled.
 *
 * The clip itself is produced by `docs-site/scripts/build-previews.mjs`;
 * `check-previews.mjs` fails the build if a name here has no clip behind it.
 */

const OPEN = /^:::preview\s+([^\n]*)$/;
const CLOSE = /^:::\s*$/;

export function remarkPreviewDirective() {
  return (tree) => {
    const out = [];

    for (let i = 0; i < tree.children.length; i++) {
      const node = tree.children[i];

      const inline = matchSingleNodeDirective(node);
      if (inline) {
        out.push({ type: "html", value: previewHtml(inline.attrs) });
        // One node consumed; the loop's own `i++` moves past it.
        continue;
      }

      const block = matchBlockDirective(tree.children, i);
      if (block) {
        out.push({ type: "html", value: previewHtml(block.attrs) });
        out.push(...block.body);
        i = block.end;
        continue;
      }

      out.push(node);
    }

    tree.children = out;
  };
}

/**
 * The common case: one paragraph whose text is the directive and its closing
 * line, with no body between them.
 */
function matchSingleNodeDirective(node) {
  if (node.type !== "paragraph") return undefined;
  const text = plainText(node);
  if (text === undefined) return undefined;

  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines.length !== 2) return undefined;

  const open = OPEN.exec(lines[0]);
  if (!open || !CLOSE.test(lines[1])) return undefined;

  const attrs = parseAttrs(open[1]);
  if (!attrs.name) return undefined;
  return { attrs };
}

/** A directive whose body spans several nodes, ending at a `:::` paragraph. */
function matchBlockDirective(children, start) {
  const node = children[start];
  if (node.type !== "paragraph") return undefined;
  const text = plainText(node);
  if (text === undefined) return undefined;

  const open = OPEN.exec(text.trim());
  if (!open) return undefined;
  const attrs = parseAttrs(open[1]);
  if (!attrs.name) return undefined;

  const body = [];
  for (let j = start + 1; j < children.length; j++) {
    const candidate = children[j];
    if (candidate.type === "paragraph" && plainText(candidate)?.trim() === ":::") {
      return { attrs, body, end: j };
    }
    body.push(candidate);
  }
  // Unterminated: leave it alone rather than eating the rest of the page.
  return undefined;
}

/** The text of a paragraph made of a single text node, or `undefined`. */
function plainText(node) {
  if (node.type !== "paragraph" || node.children?.length !== 1) return undefined;
  const child = node.children[0];
  return child.type === "text" ? child.value : undefined;
}

/**
 * Read `key="value"` pairs.
 *
 * Both quote styles are accepted — see the note at the top about Smartypants.
 */
function parseAttrs(input) {
  const out = {};
  const re = /(\w+)\s*=\s*(?:"([^"]*)"|\u201c([^\u201d]*)\u201d)/g;
  let m;
  while ((m = re.exec(input))) out[m[1]] = m[2] ?? m[3];
  return out;
}

function previewHtml({ name, caption }) {
  const src = `/kino/previews/${name}.mp4`;
  const label = escapeHtml(caption ?? name);
  return (
    `<figure class="preview">` +
    `<video src="${src}" muted loop autoplay playsinline preload="metadata" aria-label="${label}"></video>` +
    `<figcaption>${label}</figcaption>` +
    `</figure>`
  );
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Every `:::preview name="…"` in a markdown file.
 *
 * Used by `check-previews.mjs`, which reads the raw markdown rather than the
 * parsed tree, so it has to accept straight quotes only.
 */
export function previewNamesIn(markdown) {
  const names = [];
  const re = /^:::preview\s+.*?name\s*=\s*"([^"]+)"/gm;
  let m;
  while ((m = re.exec(markdown))) names.push(m[1]);
  return names;
}
