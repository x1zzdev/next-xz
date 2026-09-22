import { measure, type Clock, type LatencyStats } from "./stats.js";

export const DEFAULT_FFI_BUDGET_MS = 0.5;

export interface BenchmarkCase {
  readonly name: string;
  readonly native: () => unknown;
  readonly ffi: () => unknown;
}

export interface CompareOptions {
  readonly iterations: number;
  readonly warmup?: number;
  readonly budgetMs?: number;
  readonly clock?: Clock;
}

export interface BenchmarkComparison {
  readonly name: string;
  readonly native: LatencyStats;
  readonly ffi: LatencyStats;
  readonly overheadMs: number;
  readonly budgetMs: number;
  readonly withinBudget: boolean;
}

export interface BenchmarkSuiteResult {
  readonly comparisons: readonly BenchmarkComparison[];
  readonly withinBudget: boolean;
}

export function compareCallOverhead(
  benchmark: BenchmarkCase,
  options: CompareOptions,
): BenchmarkComparison {
  const budgetMs = options.budgetMs ?? DEFAULT_FFI_BUDGET_MS;
  const measureOptions =
    options.clock === undefined
      ? { iterations: options.iterations, warmup: options.warmup ?? 0 }
      : { iterations: options.iterations, warmup: options.warmup ?? 0, clock: options.clock };

  const native = measure(benchmark.native, measureOptions);
  const ffi = measure(benchmark.ffi, measureOptions);
  const overheadMs = ffi.meanMs - native.meanMs;
  return {
    name: benchmark.name,
    native,
    ffi,
    overheadMs,
    budgetMs,
    withinBudget: overheadMs < budgetMs,
  };
}

export function runBenchmarks(
  benchmarks: readonly BenchmarkCase[],
  options: CompareOptions,
): BenchmarkSuiteResult {
  const comparisons = benchmarks.map((benchmark) => compareCallOverhead(benchmark, options));
  return {
    comparisons,
    withinBudget: comparisons.every((comparison) => comparison.withinBudget),
  };
}

export function formatBenchmarkReport(result: BenchmarkSuiteResult): string {
  const lines: string[] = [];
  for (const comparison of result.comparisons) {
    lines.push(comparison.name);
    lines.push(
      `  native  mean ${comparison.native.meanMs.toFixed(4)} ms  p95 ${comparison.native.p95Ms.toFixed(4)} ms  ${comparison.native.throughputPerSecond.toFixed(0)} calls/s`,
    );
    lines.push(
      `  ffi     mean ${comparison.ffi.meanMs.toFixed(4)} ms  p95 ${comparison.ffi.p95Ms.toFixed(4)} ms  ${comparison.ffi.throughputPerSecond.toFixed(0)} calls/s`,
    );
    lines.push(
      `  overhead ${comparison.overheadMs.toFixed(4)} ms (budget ${comparison.budgetMs.toFixed(4)} ms) ${comparison.withinBudget ? "PASS" : "FAIL"}`,
    );
  }
  return lines.join("\n");
}
