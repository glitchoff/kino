import React from "react";
import { Film } from "lucide-react";
import { useStudioStore } from "../store/useStudioStore";

export const Navbar: React.FC = () => {
  const { examples, selectedExampleKey, loadExample } = useStudioStore();

  return (
    <header className="navbar">
      <div className="brand">
        <span className="logo-icon-wrap">
          <Film className="logo-icon-svg" />
        </span>
        <div>
          <h1 className="logo-text">Kino Studio</h1>
          <p className="tagline">JSON to Video · Render Studio</p>
        </div>
      </div>
      <div className="header-actions">
        <label htmlFor="preset-select" className="preset-label">
          Example:
        </label>
        <select
          id="preset-select"
          className="preset-dropdown"
          value={selectedExampleKey}
          onChange={(e) => loadExample(e.target.value)}
        >
          {Object.keys(examples).map((key) => (
            <option key={key} value={key}>
              examples/{key}.json
            </option>
          ))}
        </select>
      </div>
    </header>
  );
};
