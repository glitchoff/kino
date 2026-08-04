import React, { useEffect } from "react";
import { Navbar } from "./components/Navbar";
import { EditorPanel } from "./components/EditorPanel";
import { Dock } from "./components/Dock";
import { RenderControls } from "./components/RenderControls";
import { VideoPreview } from "./components/VideoPreview";
import { useStudioStore } from "./store/useStudioStore";
import "./styles.css";

export const App: React.FC = () => {
  const { fetchExamples, renderVideo, formatJson } = useStudioStore();

  useEffect(() => {
    fetchExamples();
  }, [fetchExamples]);

  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        renderVideo();
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        formatJson();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [renderVideo, formatJson]);

  return (
    <div className="app-container">
      <Navbar />
      <main className="workspace">
        <EditorPanel />
        <section className="panel preview-panel">
          <RenderControls />
          <VideoPreview />
        </section>
      </main>
      <Dock />
    </div>
  );
};
