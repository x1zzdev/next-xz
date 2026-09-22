import type { Diagnostic, DiagnosticCategory, DiagnosticSeverity } from "./diagnostics.js";

const SEVERITY_RANK: Readonly<Record<DiagnosticSeverity, number>> = {
  error: 0,
  warning: 1,
};

const CATEGORY_RANK: Readonly<Record<DiagnosticCategory, number>> = {
  lex: 0,
  parse: 1,
  resolve: 2,
  type: 3,
  intent: 4,
};

function confidence(diagnostic: Diagnostic): number {
  return diagnostic.suggestion?.confidence ?? 0;
}

export function rankDiagnostics(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return [...diagnostics].sort(
    (left, right) =>
      SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] ||
      CATEGORY_RANK[left.category] - CATEGORY_RANK[right.category] ||
      confidence(right) - confidence(left),
  );
}