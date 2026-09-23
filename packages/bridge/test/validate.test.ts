import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatInterfaceProblem,
  parseInterface,
  validateInterface,
  type Interface,
} from "../src/index.js";

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

test("flags a @cstruct record declared more than once", () => {
  const iface = parseInterface(
    "@cstruct record Vec2 { x: Float y: Float }\n@cstruct record Vec2 { a: Int b: Int }\n",
  );
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "duplicate");
  assert.equal(problems[0]?.symbol, "Vec2");
  assert.match(formatInterfaceProblem(problems[0]!), /declared more than once/);
});

test("reports a duplicate @cstruct name only once", () => {
  const iface = parseInterface(
    "@cstruct record Vec2 { x: Float }\n@cstruct record Vec2 { x: Float }\n@cstruct record Vec2 { x: Float }\n",
  );
  const duplicates = validateInterface(iface).filter((problem) => problem.kind === "duplicate");
  assert.equal(duplicates.length, 1);
});

test("flags a @cstruct name that collides with a built-in primitive", () => {
  const iface = parseInterface("@cstruct record Int { value: Float }\n");
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "reserved");
  assert.equal(problems[0]?.symbol, "Int");
  assert.match(formatInterfaceProblem(problems[0]!), /collides with the built-in type 'Int'/);
});

test("reports a reserved @cstruct name only once", () => {
  const iface = parseInterface(
    "@cstruct record Str { a: Int }\n@cstruct record Str { a: Int }\n",
  );
  const reserved = validateInterface(iface).filter((problem) => problem.kind === "reserved");
  assert.equal(reserved.length, 1);
});

test("flags an extern function declared more than once", () => {
  const iface = parseInterface("extern func f() -> Int\nextern func f() -> Int\n");
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "duplicate");
  assert.equal(problems[0]?.symbol, "f");
  assert.match(formatInterfaceProblem(problems[0]!), /extern function is declared more than once/);
});

test("reports a duplicate extern function name only once", () => {
  const iface = parseInterface("extern func f() -> Int\nextern func f() -> Int\nextern func f() -> Int\n");
  const duplicates = validateInterface(iface).filter((problem) => problem.kind === "duplicate");
  assert.equal(duplicates.length, 1);
});

test("formats a problem with symbol, location, and reason", () => {
  const iface = parseInterface("extern func parse(value: Missing) -> Int\n");
  const problem = validateInterface(iface)[0]!;
  const message = formatInterfaceProblem(problem);
  assert.match(message, /^symbol 'parse': parameter 'value' type 'Missing'/);
  assert.match(message, /unknown type 'Missing'/);
});

test("rejects a transfer parameter on the exported boundary", () => {
  const iface = parseInterface(
    [
      "@cstruct record Buffer { ptr: Ptr size: Int }",
      "extern func write(transfer frame: Bytes) -> Int",
      "extern func send(transfer text: Str)",
      "extern func install(transfer handle: Ptr)",
      "extern func fill(transfer buffer: Buffer)",
    ].join("\n"),
  );
  const problems = validateInterface(iface);
  assert.equal(problems.length, 4);
  assert.ok(
    problems.every((problem) => problem.kind === "ownership" && problem.position === "param"),
  );
  assert.match(formatInterfaceProblem(problems[0]!), /parameter 'frame' of type 'Bytes'/);
  assert.match(formatInterfaceProblem(problems[0]!), /C ABI ownership declaration/);
});

test("rejects a transfer parameter regardless of its type", () => {
  for (const source of [
    "extern func take(transfer amount: Int) -> Int\n",
    "extern func f(transfer v: Result[Int, Int]) -> Int\n",
    "extern func f(transfer v: Missing) -> Int\n",
  ]) {
    const problems = validateInterface(parseInterface(source));
    assert.ok(
      problems.some((problem) => problem.kind === "ownership" && problem.position === "param"),
      source,
    );
  }
});

test("flags a transfer return that is not pointer-carrying", () => {
  const iface = parseInterface("extern func count() -> transfer Int\n");
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "ownership");
  assert.equal(problems[0]?.position, "return");
  assert.match(formatInterfaceProblem(problems[0]!), /return type of type 'Int'/);
});

test("rejects a parameter that combines mut and transfer", () => {
  const iface: Interface = {
    cstructs: [],
    funcs: [
      {
        name: "bad",
        params: [{ name: "value", mutable: true, transfer: true, type: { kind: "named", name: "Bytes" } }],
        returnType: { kind: "named", name: "Int" },
        transferReturn: false,
      },
    ],
  };
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "ownership");
  assert.match(formatInterfaceProblem(problems[0]!), /C ABI ownership declaration/);
});

test("reports transfer and a non-representable type as separate problems", () => {
  const generic = validateInterface(parseInterface("extern func f(transfer v: Result[Int, Int]) -> Int\n"));
  assert.deepEqual(generic.map((problem) => problem.kind), ["generic", "ownership"]);
  const unknown = validateInterface(parseInterface("extern func f(transfer v: Missing) -> Int\n"));
  assert.deepEqual(unknown.map((problem) => problem.kind), ["unknown", "ownership"]);
});