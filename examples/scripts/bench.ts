import { pathToFileURL } from "node:url";

import {
  BridgeRuntimeError,
  formatBenchmarkReport,
  loadKoffiBackend,
  runBenchmarks,
  type BenchmarkCase,
  type FfiBackend,
} from "@xz-lang/bridge";

import { bind, type Binding, type LineItem } from "../src/xz/order.js";

export const BENCH_ITERATIONS = 100_000;
export const BENCH_WARMUP = 10_000;

export function nativeLineTotal(item: LineItem): number {
  return item.quantity * item.unit_price;
}

export function nativePayableTotal(subtotal: number, taxRate: number): number {
  return subtotal * (1 + taxRate);
}

export function orderBenchmarks(binding: Binding): BenchmarkCase[] {
  const item: LineItem = { quantity: 3, unit_price: 2.5 };
  return [
    {
      name: "line_total(LineItem) -> Float",
      native: () => nativeLineTotal(item),
      ffi: () => binding.line_total(item),
    },
    {
      name: "payable_total(Float, Float) -> Float",
      native: () => nativePayableTotal(7.5, 0.1),
      ffi: () => binding.payable_total(7.5, 0.1),
    },
  ];
}

async function main(): Promise<void> {
  let backend: FfiBackend;
  try {
    backend = await loadKoffiBackend();
  } catch (error) {
    if (error instanceof BridgeRuntimeError) {
      console.error(`benchmark unavailable: ${error.message}`);
      console.error(
        "Install koffi and build .next-xz/liborder.so (`xz build --shared`), then rerun.",
      );
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const binding = bind(backend);
  try {
    const result = runBenchmarks(orderBenchmarks(binding), {
      iterations: BENCH_ITERATIONS,
      warmup: BENCH_WARMUP,
    });
    console.log(formatBenchmarkReport(result));
    process.exitCode = result.withinBudget ? 0 : 1;
  } finally {
    binding.close();
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
