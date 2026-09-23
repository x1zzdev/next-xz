import assert from "node:assert/strict";
import { test } from "node:test";

import { formatInterfaceProblem, parseInterface, validateInterface } from "../src/index.js";

test("accepts an interface whose types are all C-representable", () => {
  const iface = parseInterface(
    [
      "@cstruct record Vec2 { x: Float y: Float }",
      "@cstruct record Line { a: Vec2 b: Vec2 }",
      "extern func add(a: Int, b: Int) -> Int",
      "extern func sum(v: Line) -> Float",
      "extern func name(id: Int) -> Str",
      "extern func raw() -> Bytes",
      "extern func noop()",
    ].join("\n"),
  );
  assert.deepEqual(validateInterface(iface), []);
});

test("flags a generic parameter with its symbol and path", () => {
  const iface = parseInterface("extern func parse(value: Result[Int, Int]) -> Int\n");
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "generic");
  assert.equal(problems[0]?.symbol, "parse");
  assert.equal(problems[0]?.position, "param");
  assert.deepEqual(problems[0]?.path, ["value"]);
  assert.equal(problems[0]?.type, "Result[Int, Int]");
});

test("treats Unit as return-only", () => {
  assert.equal(
    validateInterface(parseInterface("extern func noop()\n")).length,
    0,
  );
  const problems = validateInterface(parseInterface("extern func bad(u: Unit) -> Int\n"));
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "unit");
  assert.equal(problems[0]?.position, "param");
});

test("flags an undeclared record type", () => {
  const problems = validateInterface(parseInterface("extern func f(b: Buffer) -> Int\n"));
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "unknown");
  assert.equal(problems[0]?.type, "Buffer");
});

test("treats a Str field as C-representable even though the generator cannot marshal it", () => {
  const iface = parseInterface("@cstruct record Name { text: Str }\nextern func id(n: Name) -> Name\n");
  assert.deepEqual(validateInterface(iface), []);
});

test("flags a nested @cstruct field problem at its declaration site", () => {
  const iface = parseInterface("@cstruct record Bad { value: Buffer }\nextern func f(b: Bad) -> Int\n");
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.symbol, "Bad");
  assert.equal(problems[0]?.position, "field");
  assert.deepEqual(problems[0]?.path, ["value"]);
});

test("detects a @cstruct cycle instead of recursing forever", () => {
  const iface = parseInterface("@cstruct record A { b: B }\n@cstruct record B { a: A }\n");
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "cycle");
  assert.equal(problems[0]?.reason, "@cstruct records must not form a cycle");
});

test("collects every problem in one pass", () => {
  const iface = parseInterface(
    "extern func a(x: Missing) -> Result[Int, Int]\nextern func b(u: Unit) -> Int\n",
  );
  const kinds = validateInterface(iface).map((problem) => problem.kind).sort();
  assert.deepEqual(kinds, ["generic", "unit", "unknown"]);
});

test("formats a problem with symbol, location, and reason", () => {
  const iface = parseInterface("extern func parse(value: Missing) -> Int\n");
  const problem = validateInterface(iface)[0]!;
  const message = formatInterfaceProblem(problem);
  assert.match(message, /^symbol 'parse': parameter 'value' type 'Missing'/);
  assert.match(message, /unknown type 'Missing'/);
});