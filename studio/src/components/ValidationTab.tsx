import React, { useState } from "react";
import { CheckCircle2, AlertTriangle, Copy, Check } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";

export const ValidationTab: React.FC = () => {
  const { validationIssues } = useStudioStore();
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (validationIssues.length === 0) return;
    const textLines = ["Invalid Kino composition", ""];
    for (const issue of validationIssues) {
      textLines.push(issue.path);
      textLines.push(`  ${issue.message}`);
      textLines.push("");
    }
    const text = textLines.join("\n").trimEnd();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (validationIssues.length === 0) {
    return (
      <div className="validation-view-container">
        <div className="validation-view-header">
          <div className="validation-view-title">
            <CheckCircle2 className="icon-success" />
            <h3>No Schema Issues Detected</h3>
          </div>
        </div>
        <div className="validation-issues-list">
          <div style={{ color: "var(--text-muted)", fontSize: "0.9rem", padding: "2.5rem 1rem", textAlign: "center" }}>
            <p style={{ marginBottom: "0.5rem" }}>
              <CheckCircle2 style={{ width: "2rem", height: "2rem", color: "#34d399" }} />
            </p>
            <p>All composition properties pass schema validation cleanly.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="validation-view-container">
      <div className="validation-view-header">
        <div className="validation-view-title">
          <AlertTriangle className="icon-warn" />
          <h3>Schema Validation Issues ({validationIssues.length})</h3>
        </div>
        <button className="btn btn-sm btn-secondary" onClick={handleCopy}>
          {copied ? <Check className="btn-sm-icon" /> : <Copy className="btn-sm-icon" />}
          {copied ? "Copied!" : "Copy Issues"}
        </button>
      </div>
      <div className="validation-issues-list">
        {validationIssues.map((issue, idx) => (
          <div key={idx} className="validation-issue-card">
            <span className="issue-path">{issue.path}</span>
            <span className="issue-message">{issue.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
};
