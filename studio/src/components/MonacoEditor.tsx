import React, { useRef, useEffect } from "react";
import Editor, { OnMount } from "@monaco-editor/react";
import { useStudioStore } from "../store/useStudioStore";
import { createMonacoMarkers } from "../utils/monacoDiagnostics";

export const MonacoEditorComponent: React.FC = () => {
  const { jsonText, setJsonText, validationIssues } = useStudioStore();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);

  const handleEditorDidMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;
  };

  useEffect(() => {
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        const markers = createMonacoMarkers(jsonText, validationIssues);
        monacoRef.current.editor.setModelMarkers(model, "kino-validator", markers);
      }
    }
  }, [jsonText, validationIssues]);

  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <Editor
        height="100%"
        defaultLanguage="json"
        theme="vs-dark"
        value={jsonText}
        onChange={(val) => setJsonText(val || "")}
        onMount={handleEditorDidMount}
        options={{
          fontSize: 13.5,
          fontFamily: "'Fira Code', monospace",
          lineNumbers: "on",
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          automaticLayout: true,
          wordWrap: "on",
          tabSize: 2,
          padding: { top: 12, bottom: 12 },
        }}
      />
    </div>
  );
};
