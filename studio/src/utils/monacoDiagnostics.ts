export interface ValidationIssue {
  path: string;
  message: string;
}

export interface MonacoMarker {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
  message: string;
  severity: number; // 8 = MarkerSeverity.Error
}

export function parsePathSegments(path: string): string[] {
  const segments: string[] = [];
  const regex = /([^.[\]]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(path)) !== null) {
    segments.push(match[1]);
  }
  return segments;
}

export function locatePathInJsonText(jsonText: string, path: string): { line: number; col: number; length: number } | null {
  const lines = jsonText.split("\n");
  const segments = parsePathSegments(path);
  if (segments.length === 0) return null;

  const targetKey = segments[segments.length - 1];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keyMatch = new RegExp(`"${targetKey}"\\s*:`).exec(line);
    if (keyMatch) {
      return {
        line: i + 1,
        col: keyMatch.index + 1,
        length: keyMatch[0].length,
      };
    }
  }

  return null;
}

export function createMonacoMarkers(jsonText: string, issues: ValidationIssue[]): MonacoMarker[] {
  const markers: MonacoMarker[] = [];
  const lines = jsonText.split("\n");

  for (const issue of issues) {
    const pos = locatePathInJsonText(jsonText, issue.path);
    if (pos) {
      markers.push({
        startLineNumber: pos.line,
        startColumn: pos.col,
        endLineNumber: pos.line,
        endColumn: pos.col + pos.length,
        message: `${issue.path}: ${issue.message}`,
        severity: 8, // Error
      });
    } else {
      // Fallback to top line if path not matched
      markers.push({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: 1,
        endColumn: Math.max(2, (lines[0] || "").length + 1),
        message: `${issue.path}: ${issue.message}`,
        severity: 8,
      });
    }
  }

  return markers;
}
