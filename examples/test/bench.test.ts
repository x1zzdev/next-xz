import assert from "node:assert/strict";
import { test } from "node:test";

import { runBenchmarks, type Clock, type FfiBackend } from "@xz-lang/bridge";

import { bind } from "../src/xz/order.js";
import { nativeLineTotal, nativePayableTotal, orderBenchmarks } from "../scripts/bench.js";

function fakeBackend(): FfiBackend {
  return {
    dlopen: () => ({
      symbols: {
        line_total: (item: unknown) => {
          const value = item as { quantity: bigint; unit_price: number };
          return Number(value.quantity) * value.unit_price;
        },
        payable_total: (subtotal: unknown, taxRate: unknown) =>
          (subtotal as number) * (1 + (taxRate as number)),
      },
      close: () => {},
    }),
  };
}

test("native implementations match the Xz bodies", () => {
  assert.equal(nativeLineTotal({ quantity: 3n, unit_price: 2.5 }), 7.5);
  assert.equal(nativePayableTotal(7.5, 0.1), 8.25);
});

test("each benchmark case computes the same value on both paths", () => {
  const binding = bind(fakeBackend());
  try {
    for (const benchmark of orderBenchmarks(binding)) {
      assert.equal(benchmark.native(), benchmark.ffi(), benchmark.name);
    }
  } finally {
    binding.close();
  }
});

test("the order suite runs through the harness with an injected clock", () => {
  let time = 0;
  const clock: Clock = {
    now: () => {
      const value = time;
      time += 1;
      return value;
    },
  };
  const binding = bind(fakeBackend());
  try {
    const result = runBenchmarks(orderBenchmarks(binding), { iterations: 3, clock });
    assert.equal(result.comparisons.length, 2);
    assert.equal(result.withinBudget, true);
  } finally {
    binding.close();
  }
});
