import assert from "node:assert/strict";
import { test } from "node:test";

import { extractDocClaims, extractSignature } from "../src/index.js";

const ORDER = `/// Computes the payable total for an order.
/// @intent  Sums line items and applies the tax rate.
/// @ensures result >= 0.0
/// @effects none
@export func payable_total(subtotal: Float, tax_rate: Float) -> Float
    post result >= 0.0
{
    subtotal * (1.0 + tax_rate)
}
`;

test("reads intent, effects, and claims from a doc comment", () => {
  assert.deepEqual(extractDocClaims(ORDER), {
    intent: "Sums line items and applies the tax rate.",
    declaredEffects: ["none"],
    requires: [],
    ensures: ["result >= 0.0"],
    trustedClaims: [],
  });
});

test("renders the signature without the body or contract lines", () => {
  assert.equal(
    extractSignature(ORDER),
    "func payable_total(subtotal: Float, tax_rate: Float) -> Float",
  );
});

test("captures a @trusted stamp with its review note", () => {
  const source = `/// @intent Returns a positive value.
/// @ensures result > 0  @trusted  // reviewed by human on 2026-09-08
/// @effects none
func positive(x: Float) -> Float
    post result > 0
{
    x
}
`;
  assert.deepEqual(extractDocClaims(source).trustedClaims, [
    { claim: "result > 0", note: "reviewed by human on 2026-09-08" },
  ]);
});

test("records a @trusted stamp with an empty note when no review note exists", () => {
  const source = `/// @intent Returns a positive value.
/// @ensures result > 0  @trusted
/// @effects none
func positive(x: Float) -> Float
    post result > 0
{
    x
}
`;
  assert.deepEqual(extractDocClaims(source).trustedClaims, [
    { claim: "result > 0", note: "" },
  ]);
});

test("splits a comma-separated @effects declaration", () => {
  const source = `/// @intent Writes a file.
/// @effects mut, io
func write(mut n: Int) -> Unit
{
}
`;
  assert.deepEqual(extractDocClaims(source).declaredEffects, ["mut", "io"]);
});

test("returns empty claims and a best-effort signature without a doc comment", () => {
  const source = `@export func add(a: Int, b: Int) -> Int
    post result == a + b
{
    a + b
}
`;
  assert.deepEqual(extractDocClaims(source), {
    intent: "",
    declaredEffects: [],
    requires: [],
    ensures: [],
    trustedClaims: [],
  });
  assert.equal(extractSignature(source), "func add(a: Int, b: Int) -> Int");
});
