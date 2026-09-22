import assert from "node:assert/strict";
import { test } from "node:test";

import {
  SYSTEM_PROMPT,
  buildPrompt,
  extractCandidate,
  formatDiagnostics,
  summarizeChange,
  type Diagnostic,
} from "../src/index.js";

function diagnostic(code: string, category: Diagnostic["category"], confidence?: number): Diagnostic {
  return {
    version: 1,
    severity: "error",
    code,
    message: `${code} message`,
    category,
    span: { file: "src/main.xz", start: [4, 6], end: [4, 7] },
    ...(confidence === undefined ? {} : { suggestion: { fix: `fix ${code}`, confidence } }),
  };
}

test("initial prompt carries the intent, target, and system invariants", () => {
  const prompt = buildPrompt({
    intent: "Compute the payable total for an order.",
    target: "src/logic/order.xz",
    attempt: 1,
    retries: 3,
  });
  assert.equal(prompt.system, SYSTEM_PROMPT);
  assert.match(prompt.user, /Compute the payable total for an order\./);
  assert.match(prompt.user, /Target file: src\/logic\/order\.xz/);
  assert.match(prompt.user, /Attempt 1 of 3\./);
  assert.doesNotMatch(prompt.user, /Repair:/);
  assert.match(prompt.system, /I0022/);
  assert.match(prompt.system, /I0020/);
});

test("initial prompt embeds the contract shell", () => {
  const prompt = buildPrompt({
    intent: "x",
    target: "order.xz",
    attempt: 1,
    retries: 3,
    shell: "@intent\nexport func f() {}",
  });
  assert.match(prompt.user, /Contract shell to preserve:/);
  assert.match(prompt.user, /export func f\(\) \{\}/);
});

test("repair prompt injects ranked diagnostics and the previous candidate", () => {
  const prompt = buildPrompt({
    intent: "x",
    target: "order.xz",
    attempt: 2,
    retries: 3,
    previousSource: "func f() {}",
    diagnostics: [diagnostic("I0020", "intent", 0.9), diagnostic("P0001", "parse")],
  });
  assert.match(prompt.user, /Repair:/);
  const parseAt = prompt.user.indexOf("P0001");
  const intentAt = prompt.user.indexOf("I0020");
  assert.ok(parseAt !== -1 && intentAt !== -1 && parseAt < intentAt, "parse precedes intent");
  assert.match(prompt.user, /fix \(0\.90\): fix I0020/);
  assert.match(prompt.user, /Previous candidate:\nfunc f\(\) \{\}/);
});

test("repair prompt summarizes the change between the last two attempts", () => {
  const prompt = buildPrompt({
    intent: "x",
    target: "order.xz",
    attempt: 3,
    retries: 3,
    previousSource: "a\nb\nc",
    priorSource: "a\nb",
    diagnostics: [diagnostic("P0001", "parse")],
  });
  assert.match(prompt.user, /Change since the previous attempt: 1 line\(s\) added, 0 line\(s\) removed\./);
});

test("formatDiagnostics ranks and renders suggestions", () => {
  const rendered = formatDiagnostics([diagnostic("I0020", "intent", 0.5), diagnostic("P0001", "parse")]);
  assert.equal(rendered.length, 2);
  assert.match(rendered[0] ?? "", /P0001/);
  assert.match(rendered[1] ?? "", /I0020/);
  assert.match(rendered[1] ?? "", /fix \(0\.50\): fix I0020/);
});

test("summarizeChange reports an unchanged source", () => {
  assert.equal(summarizeChange("a\nb", "a\nb"), "no line changes");
});

test("extractCandidate unwraps a fenced code block", () => {
  assert.equal(extractCandidate("```xz\nfunc f() {}\n```"), "func f() {}");
});

test("extractCandidate returns plain text unchanged", () => {
  assert.equal(extractCandidate("func f() {}\n"), "func f() {}");
});