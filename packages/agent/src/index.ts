export { DiagnosticParseError, XzCheckError } from "./errors.js";
export type { CheckProcessResult } from "./errors.js";
export { parseDiagnostics } from "./diagnostics.js";
export type {
  Diagnostic,
  DiagnosticCategory,
  DiagnosticPosition,
  DiagnosticSeverity,
  DiagnosticSpan,
  DiagnosticSuggestion,
} from "./diagnostics.js";
export { resolveExecutable, runCheckJson, spawnRunner } from "./check.js";
export type { CheckJsonOptions, CheckJsonResult, ProcessRunner, ProcessRunnerOptions } from "./check.js";