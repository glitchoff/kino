import { create } from "zustand";
import type { ValidationIssue } from "../utils/monacoDiagnostics";
import type { KinoComposition } from "../../../src/types";

const DEFAULT_COMPOSITION: KinoComposition = {
  width: 1080,
  height: 1920,
  fps: 30,
  scenes: [
    {
      duration: 5,
      background: "#0f172a",
      elements: [
        {
          type: "text",
          content: "Hello Kino",
          fontSize: 72,
          fontColor: "white",
          x: "center",
          y: "center",
          startTime: 0,
          duration: 3,
        },
        {
          type: "text",
          content: "JSON to FFmpeg",
          fontSize: 48,
          fontColor: "#38bdf8",
          x: "center",
          y: "(h-text_h)/2+140",
          startTime: 2,
          duration: 3,
        },
      ],
    },
  ],
};

interface StudioState {
  jsonText: string;
  composition: KinoComposition | null;
  syntaxError: string | null;
  validationIssues: ValidationIssue[];
  activeTab: "code" | "validation";
  encoder: string;
  preset: string;
  isRendering: boolean;
  renderStatusMsg: string;
  renderStatusType: "idle" | "rendering" | "success" | "error";
  videoUrl: string | null;
  filename: string | null;
  examples: Record<string, KinoComposition>;
  selectedExampleKey: string;

  // Actions
  setJsonText: (text: string) => void;
  setActiveTab: (tab: "code" | "validation") => void;
  setEncoder: (encoder: string) => void;
  setPreset: (preset: string) => void;
  loadExample: (key: string) => void;
  fetchExamples: () => Promise<void>;
  validateServer: () => Promise<void>;
  renderVideo: () => Promise<void>;
  formatJson: () => void;
}

let validateTimer: ReturnType<typeof setTimeout> | null = null;

export const useStudioStore = create<StudioState>((set, get) => ({
  jsonText: JSON.stringify(DEFAULT_COMPOSITION, null, 2),
  composition: DEFAULT_COMPOSITION,
  syntaxError: null,
  validationIssues: [],
  activeTab: "code",
  encoder: "auto",
  preset: "veryfast",
  isRendering: false,
  renderStatusMsg: "Ready to render.",
  renderStatusType: "idle",
  videoUrl: null,
  filename: null,
  examples: { basic: DEFAULT_COMPOSITION },
  selectedExampleKey: "basic",

  setJsonText: (text: string) => {
    set({ jsonText: text });
    try {
      const parsed = JSON.parse(text);
      set({ composition: parsed, syntaxError: null });

      if (validateTimer) clearTimeout(validateTimer);
      validateTimer = setTimeout(() => {
        get().validateServer();
      }, 250);
    } catch (err: any) {
      set({
        composition: null,
        syntaxError: err.message,
        validationIssues: [],
      });
    }
  },

  setActiveTab: (tab) => set({ activeTab: tab }),
  setEncoder: (encoder) => set({ encoder }),
  setPreset: (preset) => set({ preset }),

  loadExample: (key) => {
    const examples = get().examples;
    const comp = examples[key] || DEFAULT_COMPOSITION;
    const formatted = JSON.stringify(comp, null, 2);
    set({ selectedExampleKey: key, jsonText: formatted, composition: comp, syntaxError: null });
    get().validateServer();
  },

  fetchExamples: async () => {
    try {
      const res = await fetch("/api/examples");
      const data = await res.json();
      if (data.success && data.examples && Object.keys(data.examples).length > 0) {
        set({ examples: data.examples });
        const firstKey = Object.keys(data.examples)[0];
        get().loadExample(firstKey);
      }
    } catch (err) {
      console.error("Could not fetch server examples:", err);
    }
  },

  validateServer: async () => {
    const composition = get().composition;
    if (!composition) return;

    try {
      const res = await fetch("/api/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composition }),
      });
      const data = await res.json();
      if (data.issues && Array.isArray(data.issues)) {
        set({ validationIssues: data.issues });
      } else {
        set({ validationIssues: [] });
      }
    } catch (err) {
      console.error("Validation request failed:", err);
    }
  },

  renderVideo: async () => {
    const composition = get().composition;
    if (!composition) {
      set({
        renderStatusMsg: "Fix JSON syntax errors before rendering.",
        renderStatusType: "error",
      });
      return;
    }

    const { encoder, preset } = get();

    set({
      isRendering: true,
      renderStatusMsg: `Rendering with ${encoder}, ${preset}…`,
      renderStatusType: "rendering",
    });

    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ composition, encoder, preset }),
      });

      const data = await res.json();

      if (data.success) {
        set({
          isRendering: false,
          renderStatusMsg: `Render completed · ${data.filename}`,
          renderStatusType: "success",
          videoUrl: data.videoUrl,
          filename: data.filename,
          validationIssues: [],
        });
      } else {
        if (data.issues && Array.isArray(data.issues)) {
          set({
            isRendering: false,
            validationIssues: data.issues,
            activeTab: "validation",
            renderStatusMsg: `Validation failed: ${data.issues.length} schema issue(s) found.`,
            renderStatusType: "error",
          });
        } else {
          set({
            isRendering: false,
            renderStatusMsg: `Render failed: ${data.error}`,
            renderStatusType: "error",
          });
        }
      }
    } catch (err: any) {
      set({
        isRendering: false,
        renderStatusMsg: `Render request error: ${err.message}`,
        renderStatusType: "error",
      });
    }
  },

  formatJson: () => {
    const { jsonText } = get();
    try {
      const parsed = JSON.parse(jsonText);
      const formatted = JSON.stringify(parsed, null, 2);
      set({ jsonText: formatted });
    } catch (e) {
      // Ignore format if invalid JSON syntax
    }
  },
}));
