export interface ValidationIssue {
  path: string;
  message: string;
}

function formatValidationIssues(issues: ValidationIssue[]): string {
  const lines = ["Invalid Kino composition", ""];
  for (const issue of issues) {
    lines.push(issue.path);
    lines.push(`  ${issue.message}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

export class KinoValidationError extends Error {
  public readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(formatValidationIssues(issues));
    this.name = "KinoValidationError";
    this.issues = issues;
  }
}
