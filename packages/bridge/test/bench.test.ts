import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_FFI_BUDGET_MS,
  compareCallOverhead,
  formatBenchmarkReport,
  measure,
  percentile,
  runBenchmarks,
  type Clock,
} from "../src/index.js";

function steppingClock(step: number): Clock {
  let time = 0;
  return {
    now: () => {
      const value = time;
      time += step;
      return value;
    },
  };
}

function controlledClock(): { clock: Clock; advance: (ms: number) => void } {
  let time = 0;
  return {
    clock: { now: () => time },
    advance: (ms: number) => {
      time += ms;
    },
  };
}

test("percentile uses the nearest-rank definition", () => {
  const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentile(sorted, 0.5), 5);
  assert.equal(percentile(sorted, 0.95), 10);
  assert.equal(percentile(sorted, 1), 10);
  assert.equal(percentile([], 0.5), 0);
});

test("measure runs warmup outside the timed region", () => {
  let calls = 0;
  const stats = measure(
    () => {
      calls += 1;
    },
    { iterations: 4, warmup: 2, clock: steppingClock(1) },
  );
  assert.equal(calls, 6);
  assert.equal(stats.iterations, 4);
});

test("measure reports deterministic latency with an injected clock", () => {
  const stats = measure(() => undefined, { iterations: 4, clock: steppingClock(1) });
  assert.equal(stats.iterations, 4);
  assert.equal(stats.meanMs, 1);
  assert.equal(stats.minMs, 1);
  assert.equal(stats.maxMs, 1);
  assert.equal(stats.p50Ms, 1);
  assert.equal(stats.p95Ms, 1);
  assert.equal(stats.totalMs, 9);
  assert.equal(stats.throughputPerSecond, 4000 / 9);
});

test("measure rejects a non-positive iteration count", () => {
  assert.throws(() => measure(() => undefined, { iterations: 0 }), RangeError);
});

test("compareCallOverhead subtracts the native mean from the FFI mean", () => {
  const { clock, advance } = controlledClock();
  const comparison = compareCallOverhead(
    {
      name: "f",
      native: () => {
        advance(2);
      },
      ffi: () => {
        advance(5);
      },
    },
    { iterations: 3, budgetMs: 4, clock },
  );
  assert.equal(comparison.native.meanMs, 2);
  assert.equal(comparison.ffi.meanMs, 5);
  assert.equal(comparison.overheadMs, 3);
  assert.equal(comparison.budgetMs, 4);
  assert.equal(comparison.withinBudget, true);
});

test("compareCallOverhead defaults the budget to 0.5 ms and fails above it", () => {
  const { clock, advance } = controlledClock();
  const comparison = compareCallOverhead(
    {
      name: "f",
      native: () => undefined,
      ffi: () => {
        advance(6);
      },
    },
    { iterations: 2, clock },
  );
  assert.equal(comparison.budgetMs, DEFAULT_FFI_BUDGET_MS);
  assert.equal(comparison.overheadMs, 6);
  assert.equal(comparison.withinBudget, false);
});

test("runBenchmarks requires every case to be within budget", () => {
  const result = runBenchmarks(
    [
      { name: "pass", native: () => undefined, ffi: () => undefined },
      { name: "fail", native: () => undefined, ffi: () => undefined },
    ],
    { iterations: 2, budgetMs: -1, clock: steppingClock(1) },
  );
  assert.equal(result.comparisons.length, 2);
  assert.equal(result.withinBudget, false);
});

test("formatBenchmarkReport names each case and states the verdict", () => {
  const result = runBenchmarks(
    [{ name: "payable_total", native: () => undefined, ffi: () => undefined }],
    { iterations: 2, clock: steppingClock(1) },
  );
  const report = formatBenchmarkReport(result);
  assert.match(report, /payable_total/);
  assert.match(report, /PASS/);
});
