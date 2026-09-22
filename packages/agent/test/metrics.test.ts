import assert from "node:assert/strict";
import { test } from "node:test";

import {
  classifyOutcome,
  computeRunMetrics,
  runAgent,
  summarizeKpis,
  type CheckProcessResult,
  type ProcessRunner,
  type RunMetrics,
} from "../src/index.js";

function metrics(outcome: RunMetrics["outcome"]): RunMetrics {
  return {
    outcome,
    status: outcome === "escalated" ? "escalated" : "passed",
    attempts: outcome === "first-pass" ? 1 : outcome === "self-corrected" ? 2 : 3,
    firstPass: outcome === "first-pass",
    selfCorrected: outcome === "self-corrected",
    escalated: outcome === "escalated",
  };
}

test("classifies a first-attempt pass as first-pass", () => {
  assert.equal(classifyOutcome("passed", 1), "first-pass");
});

test("classifies a repaired pass as self-corrected", () => {
  assert.equal(classifyOutcome("passed", 2), "self-corrected");
  assert.equal(classifyOutcome("passed", 3), "self-corrected");
});

test("classifies an exhausted run as escalated regardless of attempts", () => {
  assert.equal(classifyOutcome("escalated", 3), "escalated");
});

test("derives the boolean flags from the outcome", () => {
  assert.deepEqual(computeRunMetrics({ status: "passed", attempts: 1 }), metrics("first-pass"));
  assert.deepEqual(computeRunMetrics({ status: "passed", attempts: 2 }), metrics("self-corrected"));
  assert.deepEqual(computeRunMetrics({ status: "escalated", attempts: 3 }), metrics("escalated"));
});

test("summarizes counts and rates across runs", () => {
  const summary = summarizeKpis([
    metrics("first-pass"),
    metrics("self-corrected"),
    metrics("escalated"),
    metrics("escalated"),
  ]);
  assert.equal(summary.runs, 4);
  assert.equal(summary.firstPass, 1);
  assert.equal(summary.selfCorrected, 1);
  assert.equal(summary.escalated, 2);
  assert.equal(summary.firstPassRate, 0.25);
  assert.equal(summary.selfCorrectionRate, 1 / 3);
  assert.equal(summary.escalationRate, 0.5);
});

test("reports zero rates for an empty run set", () => {
  const summary = summarizeKpis([]);
  assert.equal(summary.runs, 0);
  assert.equal(summary.firstPassRate, 0);
  assert.equal(summary.selfCorrectionRate, 0);
  assert.equal(summary.escalationRate, 0);
});

test("attaches per-run metrics to the run result", async () => {
  const runner: ProcessRunner = (): Promise<CheckProcessResult> =>
    Promise.resolve({ stdout: "[]", stderr: "", exitCode: 0 });

  const result = await runAgent({
    intent: "x",
    target: "order.xz",
    generate: () => Promise.resolve("func f() {}"),
    runner,
    writeFile: () => Promise.resolve(),
  });

  assert.deepEqual(result.metrics, metrics("first-pass"));
});