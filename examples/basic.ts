// Code composition — the same video as examples/basic.json, written in TypeScript.
//
//   node dist/cli.js examples/basic.ts -o out/basic.mp4
//
// Anything a JSON composition can express is expressible here, but you get
// loops, variables, computed timings and type checking.
import { composition, fadeIn, image, text } from "@glitchoff/kino";

const SFX = "https://cdn.pixabay.com/download/audio/2025/05/29/audio_ea96cedc40.mp3?filename=universfield-mouse-click-351398.mp3";

const comp = composition({
  width: 1080,
  height: 1920,
  fps: 30,
  audio: {
    src: "https://cdn.pixabay.com/download/audio/2026/02/09/audio_42f493ea02.mp3",
    volume: 0.8,
    fadeIn: 2,
    fadeOut: 3,
  },
})
  .scene({ id: "scene-1-earth", duration: 10, background: "#0f172a" }, (s) =>
    s
      .text("The Blue Marble", {
        fontSize: 84,
        color: "#ffffff",
        box: true,
        boxColor: "black@0.6",
        boxPadding: 24,
        x: "center",
        y: "(h-text_h)/2-400",
        startAt: 1,
        duration: 8,
        sfx: { src: SFX, volume: 0.8 },
        animation: { opacity: fadeIn(0.6) },
      })
      .image("https://images.unsplash.com/photo-1614728894747-a83421e2b9c9?w=1080&auto=format&fit=crop", {
        width: 640,
        x: "center",
        y: "(main_h-overlay_h)/2+100",
        startAt: 2,
        duration: 7,
      })
  )
  .scene(
    {
      id: "scene-2-space",
      duration: 12,
      background: { type: "gradient", from: "#0f172a", to: "#7c3aed" },
    },
    (s) =>
      s
        .text("JWST Deep Field", {
          fontSize: 72,
          color: "#ffffff",
          box: true,
          boxColor: "black@0.6",
          boxPadding: 20,
          x: "center",
          y: "(h-text_h)/2-420",
          startAt: 1,
          duration: 10,
          sfx: { src: SFX, volume: 0.8 },
        })
        .image("https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=1080&auto=format&fit=crop", {
          width: 720,
          x: "center",
          y: "(main_h-overlay_h)/2+120",
          startAt: 2,
          duration: 9,
        })
  )
  .scene({ id: "scene-3-outro", duration: 10, background: "#030712" }, (s) =>
    s
      .text("Built with Kino", {
        fontSize: 80,
        color: "#38bdf8",
        box: true,
        boxColor: "black@0.6",
        boxPadding: 24,
        x: "center",
        y: "(h-text_h)/2-60",
        startAt: 1,
        duration: 8,
      })
      .text("32-Second High Definition Composition", {
        fontSize: 42,
        color: "#94a3bc",
        x: "center",
        y: "(h-text_h)/2+80",
        startAt: 2.5,
        duration: 6.5,
      })
  )
  .build();

export default comp;
