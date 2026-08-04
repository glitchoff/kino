import React from "react";
import { Code2, ShieldAlert, Video } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";

export const Dock: React.FC = () => {
  const { activeTab, setActiveTab, validationIssues, syntaxError } =
    useStudioStore();

  const issueCount = validationIssues.length;
  const isSyntaxError = Boolean(syntaxError);

  let statusText = "Valid";
  let statusClass = "dock-status valid";

  if (isSyntaxError) {
    statusText = "Invalid";
    statusClass = "dock-status invalid";
  } else if (issueCount > 0) {
    statusText = `${issueCount} issues`;
    statusClass = "dock-status error";
  }

  const tabs = [
    { key: "code" as const, icon: Code2, label: "Code" },
    { key: "validation" as const, icon: ShieldAlert, label: "Validate" },
    { key: "video" as const, icon: Video, label: "Video" },
  ];

  return (
    <nav className="dock">
      <div className="dock-tabs">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            className={`dock-tab ${activeTab === key ? "active" : ""}`}
            onClick={() => setActiveTab(key)}
          >
            <Icon className="dock-tab-icon" />
            <span className="dock-tab-label">{label}</span>
          </button>
        ))}
      </div>
      <span className={statusClass}>{statusText}</span>
    </nav>
  );
};