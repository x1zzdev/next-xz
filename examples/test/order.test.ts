import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { parseInterface, type FfiBackend } from "@xz-lang/bridge";

import { ORDER_BINDING, ORDER_INTERFACE, ORDER_SOURCE, generateOrderBinding } from "../scripts/generate.js";

const root = dirname(ORDER_INTERFACE);

test("the committed binding is the generator's current output", async () => {
  const committed = await readFile(ORDER_BINDING, "utf8");
  assert.equal(committed, await generateOrderBinding());
});

test("order.xzint and order.xz declare the same exports", async () => {
  const source = await readFile(ORDER_SOURCE, "utf8");
  const exported = [...source.matchAll(/@export\s+func\s+([A-Za-z_][A-Za-z0-9_]*)/g)].map(
    (match) => match[1],
  );
  const iface = parseInterface(await readFile(ORDER_INTERFACE, "utf8"), "order.xzint");
  assert.deepEqual(
    exported,
    iface.funcs.map((func) => func.name),
  );
});

test("the generated binding calls each symbol through the injected backend", async () => {
  const module = (await import(join(root, "src", "xz", "order.ts"))) as {
    bind(backend: FfiBackend): {
      line_total(item: { quantity: bigint; unit_price: number }): number;
      payable_total(subtotal: number, tax_rate: number): number;
      close(): void;
    };
  };

  const calls: unknown[][] = [];
  let closed = false;
  const backend: FfiBackend = {
    dlopen: () => ({
      symbols: {
        line_total: (item: unknown) => {
          calls.push([item]);
          const value = item as { quantity: bigint; unit_price: number };
          return Number(value.quantity) * value.unit_price;
        },
        payable_total: (subtotal: unknown, taxRate: unknown) => {
          calls.push([subtotal, taxRate]);
          return (subtotal as number) * (1 + (taxRate as number));
        },
      },
      close: () => {
        closed = true;
      },
    }),
  };

  const binding = module.bind(backend);
  assert.equal(binding.line_total({ quantity: 3n, unit_price: 2.5 }), 7.5);
  assert.equal(binding.payable_total(7.5, 0.1), 8.25);
  assert.deepEqual(calls, [[{ quantity: 3n, unit_price: 2.5 }], [7.5, 0.1]]);
  binding.close();
  assert.equal(closed, true);
});
