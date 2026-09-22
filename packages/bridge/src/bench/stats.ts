export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => performance.now(),
};

export interface MeasureOptions {
  readonly iterations: number;
  readonly warmup?: number;
  readonly clock?: Clock;
}

export interface LatencyStats {
  readonly iterations: number;
  readonly totalMs: number;
  readonly meanMs: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly throughputPerSecond: number;
}

export function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) {
    return 0;
  }
  const rank = Math.ceil(fraction * sorted.length);
  const index = Math.min(Math.max(rank - 1, 0), sorted.length - 1);
  return sorted[index]!;
}

export function measure(fn: () => unknown, options: MeasureOptions): LatencyStats {
  const { iterations, warmup = 0, clock = systemClock } = options;
  if (!Number.isInteger(iterations) || iterations <= 0) {
    throw new RangeError(`iterations must be a positive integer, received ${iterations}`);
  }
  if (!Number.isInteger(warmup) || warmup < 0) {
    throw new RangeError(`warmup must be a non-negative integer, received ${warmup}`);
  }

  for (let i = 0; i < warmup; i += 1) {
    fn();
  }

  const samples = new Array<number>(iterations);
  const start = clock.now();
  for (let i = 0; i < iterations; i += 1) {
    const before = clock.now();
    fn();
    samples[i] = clock.now() - before;
  }
  const totalMs = clock.now() - start;

  const sorted = [...samples].sort((left, right) => left - right);
  const sum = samples.reduce((total, sample) => total + sample, 0);
  return {
    iterations,
    totalMs,
    meanMs: sum / iterations,
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    p50Ms: percentile(sorted, 0.5),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    throughputPerSecond: totalMs > 0 ? (iterations * 1000) / totalMs : Number.POSITIVE_INFINITY,
  };
}
