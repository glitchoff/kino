import { composition } from "@glitchoff/kino";

/**
 * A 15-second Takumi demo: every frame is `s.tak()` markup, so no browser is
 * involved at any point.
 */

const W = 1280;
const H = 720;

const shell = (body: string) => `
<div style="width:100%;height:100%;display:flex;flex-direction:column;
            background:linear-gradient(135deg,#0b1220 0%,#111c33 55%,#1b1030 100%);
            color:#e2e8f0;font-family:Inter;padding:64px;box-sizing:border-box">
  ${body}
</div>`;

const card = (inner: string, extra = "") => `
<div style="display:flex;flex-direction:column;gap:14px;padding:34px 38px;border-radius:22px;
            background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.10);${extra}">
  ${inner}
</div>`;

export default composition({ width: W, height: H, fps: 30 })
  // 1 — title
  .scene({ duration: 3.5 }, (s) => {
    s.tak(
      shell(`
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:22px">
          <div style="font-size:26px;letter-spacing:8px;color:#38bdf8;font-weight:600">KINO × TAKUMI</div>
          <div style="font-size:96px;font-weight:800;line-height:1.05;letter-spacing:-2px">HTML that needs<br/>no browser</div>
          <div style="font-size:30px;color:#94a3b8;margin-top:8px">Rust layout · Blink-ported text · deterministic</div>
        </div>`),
      { width: W, height: H, x: 0, y: 0 }
    );
  })

  // 2 — three stat cards, flexbox row
  .scene({ duration: 4.5, transition: { type: "slideLeft", duration: 0.5 } }, (s) => {
    s.tak(
      shell(`
        <div style="font-size:44px;font-weight:700;margin-bottom:36px">Why it matters</div>
        <div style="flex:1;display:flex;gap:28px;align-items:stretch">
          ${card(`<div style="font-size:64px;font-weight:800;color:#38bdf8">0</div>
                  <div style="font-size:22px;color:#94a3b8;line-height:1.4">browsers launched<br/>to render these frames</div>`)}
          ${card(`<div style="font-size:64px;font-weight:800;color:#a78bfa">~8s</div>
                  <div style="font-size:22px;color:#94a3b8;line-height:1.4">to install the<br/>native binding</div>`)}
          ${card(`<div style="font-size:64px;font-weight:800;color:#34d399">1</div>
                  <div style="font-size:22px;color:#94a3b8;line-height:1.4">layout engine,<br/>same output everywhere</div>`)}
        </div>`),
      { width: W, height: H, x: 0, y: 0 }
    );
  })

  // 3 — grid of chips
  .scene({ duration: 4.5, transition: { type: "wipeRight", duration: 0.5 } }, (s) => {
    const chips = ["Flexbox", "CSS Grid", "block", "inline", "table", "float", "gradients", "masks",
                   "filters", "blend modes", "@keyframes", "Tailwind", "local fonts", "SVG", "PNG"]
      .map(
        (t) => `<div style="display:flex;align-items:center;justify-content:center;padding:16px 22px;
                      border-radius:14px;background:rgba(56,189,248,0.10);
                      border:1px solid rgba(56,189,248,0.30);font-size:24px;color:#bae6fd">${t}</div>`
      )
      .join("");

    s.tak(
      shell(`
        <div style="font-size:44px;font-weight:700;margin-bottom:30px">What Takumi supports</div>
        <div style="flex:1;display:flex;flex-wrap:wrap;gap:16px;align-content:flex-start">${chips}</div>`),
      { width: W, height: H, x: 0, y: 0 }
    );
  })

  // 4 — closing
  .scene({ duration: 4.5, transition: { type: "fade", duration: 0.5 } }, (s) => {
    s.tak(
      shell(`
        <div style="flex:1;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:26px;text-align:center">
          <div style="font-size:34px;color:#94a3b8;font-family:ui-monospace,monospace">s.tak(markup, options)</div>
          <div style="font-size:80px;font-weight:800;letter-spacing:-2px">No browser.<br/>Just layout.</div>
          <div style="display:flex;gap:18px;margin-top:10px">
            <div style="padding:14px 26px;border-radius:12px;background:#38bdf8;color:#07131f;
                        font-size:24px;font-weight:700">takumi.kane.tw</div>
            <div style="padding:14px 26px;border-radius:12px;border:1px solid rgba(255,255,255,0.18);
                        font-size:24px;color:#cbd5e1">@glitchoff/kino</div>
          </div>
        </div>`),
      { width: W, height: H, x: 0, y: 0 }
    );
  })
  .build();
