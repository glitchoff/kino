import React from "react";
import { Code2, ShieldAlert, AlignLeft } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";
import { MonacoEditorComponent } from "./MonacoEditor";
import { ValidationTab } from "./ValidationTab";

export const EditorPanel: React.FC = () => {
  const {
    activeTab,
    setActiveTab,
    validationIssues,
    syntaxError,
    formatJson,
  } = useStudioStore();

  const issueCount = validationIssues.length;
  const isSyntaxError = Boolean(syntaxError);

  let statusText = "Valid JSON";
  let statusClass = "status-badge valid";

  if (isSyntaxError) {
    statusText = "Invalid Syntax";
    statusClass = "status-badge invalid";
  } else if (issueCount > 0) {
    statusText = `Schema Error (${issueCount})`;
    statusClass = "status-badge validation-error";
  }

  return (
    <section className="panel editor-panel">
      <div className="panel-header">
        <div className="panel-tabs">
          <button
            className={`panel-tab ${activeTab === "code" ? "active" : ""}`}
            onClick={() => setActiveTab("code")}
          >
            <Code2 className="tab-icon" />
            <span>JSON Code</span>
          </button>
          <button
            className={`panel-tab ${activeTab === "validation" ? "active" : ""}`}
            onClick={() => setActiveTab("validation")}
          >
            <ShieldAlert className="tab-icon" />
            <span>Validation</span>
            <span className={`tab-badge ${issueCount > 0 ? "error" : "zero"}`}>
              {issueCount}
            </span>
          </button>
        </div>
        <div className="panel-header-right">
          <button
            className="btn btn-secondary btn-sm"
            onClick={formatJson}
            title="Pretty-print the JSON (Ctrl/Cmd+Shift+F)"
          >
            <AlignLeft className="btn-sm-icon" /> Format
          </button>
          <span
            className={statusClass}
            style={{ cursor: "pointer" }}
            onClick={() => setActiveTab("validation")}
            title="Click to view validation issues"
          >
            {statusText}
          </span>
        </div>
      </div>

      {activeTab === "code" ? (
        <div className="tab-view active">
          <MonacoEditorComponent />
        </div>
      ) : (
        <div className="tab-view active">
          <ValidationTab />
        </div>
      )}
    </section>
  );
};
