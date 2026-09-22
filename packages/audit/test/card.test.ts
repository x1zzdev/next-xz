import assert from "node:assert/strict";
import { test } from "node:test";

import type { Diagnostic } from "@xz-lang/agent";

import { buildAuditCard } from "../src/index.js";

const SOURCE = `/// Computes the payable total for an order.
/// @intent  Sums line items and applies the tax rate.
/// @ensures result >= 0.0
/// @effects none
@export func payable_total(subtotal: Float, tax_rate: Float) -> Float
    post result >= 0.0
{
    subtotal * (1.0 + tax_rate)
}
`;

const DIAGNOSTIC: Diagnostic = {
  version: 1,
  severity: "error",
  code: "I0020",
  message: "declared @effects 'none' does not match derived effects 'io'",
  category: "intent",
  span: { file: "order.xz", start: [4, 6], end: [4, 7] },
};

test("assembles a card from source with pending defaults", () => {
  assert.deepEqual(buildAuditCard({ module: "order", source: SOURCE }), {
    module: "order",
    signature: "func payable_total(subtotal: Float, tax_rate: Float) -> Float",
    intent: "Sums line items and applies the tax rate.",
    declaredEffects: ["none"],
    derivedEffects: [],
    trustedClaims: [],
    diagnostics: [],
    diff: "",
    status: "pending",
  });
});

test("leaves derivedEffects empty until the extraction supplies them", () => {
  const card = buildAuditCard({ module: "order", source: SOURCE });
  assert.deepEqual(card.derivedEffects, []);
});

test("carries an explicitly supplied derived profile", () => {
  const card = buildAuditCard({
    module: "order",
    source: SOURCE,
    derivedEffects: ["io"],
  });
  assert.deepEqual(card.derivedEffects, ["io"]);
});

test("passes the clearing diagnostic run and diff through", () => {
  const card = buildAuditCard({
    module: "order",
    source: SOURCE,
    diagnostics: [DIAGNOSTIC],
    diff: "-old\n+new\n",
  });
  assert.deepEqual(card.diagnostics, [DIAGNOSTIC]);
  assert.equal(card.diff, "-old\n+new\n");
});

test("accepts a non-default status", () => {
  const card = buildAuditCard({ module: "order", source: SOURCE, status: "blocked" });
  assert.equal(card.status, "blocked");
});
