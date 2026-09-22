"use server";

import { loadKoffiBackend } from "@xz-lang/bridge";

import { bind, type Binding } from "../src/xz/order.js";

let cached: Promise<Binding> | undefined;

async function order(): Promise<Binding> {
  cached ??= loadKoffiBackend().then((backend) => bind(backend));
  return cached;
}

export async function payableTotal(subtotal: number, taxRate: number): Promise<number> {
  const binding = await order();
  return binding.payable_total(subtotal, taxRate);
}
