import assert from "node:assert/strict";
import { test } from "node:test";

import { rankDiagnostics, type Diagnostic, type DiagnosticCategory } from "../src/index.js";

function diagnostic(
  code: string,
  severity: Diagnostic["severity"],
  category: DiagnosticCategory,
  confidence?: number,
): Diagnostic {
  return {
    version: 1,
    severity,
    code,
    message: code,
    category,
    span: { file: "a.xz", start: [1, 1], end: [1, 1] },
    ...(confidence === undefined ? {} : { suggestion: { fix: code, confidence } }),
  };
}

test("orders errors before warnings", () => {
  const ranked = rankDiagnostics([
    diagnostic("W", "warning", "type"),
    diagnostic("E", "error", "intent"),
  ]);
  assert.deepEqual(
    ranked.map((entry) => entry.code),
    ["E", "W"],
  );
});

test("orders by category within the same severity", () => {
  const ranked = rankDiagnostics([
    diagnostic("I", "error", "intent"),
    diagnostic("T", "error", "type"),
    diagnostic("L", "error", "lex"),
    diagnostic("R", "error", "resolve"),
    diagnostic("P", "error", "parse"),
  ]);
  assert.deepEqual(
    ranked.map((entry) => entry.code),
    ["L", "P", "R", "T", "I"],
  );
});

test("orders by confidence descending, missing suggestion last", () => {
  const ranked = rankDiagnostics([
    diagnostic("none", "error", "intent"),
    diagnostic("low", "error", "intent", 0.2),
    diagnostic("high", "error", "intent", 0.9),
  ]);
  assert.deepEqual(
    ranked.map((entry) => entry.code),
    ["high", "low", "none"],
  );
});

test("does not mutate the input array", () => {
  const input = [diagnostic("W", "warning", "lex"), diagnostic("E", "error", "intent")];
  rankDiagnostics(input);
  assert.deepEqual(
    input.map((entry) => entry.code),
    ["W", "E"],
  );
});