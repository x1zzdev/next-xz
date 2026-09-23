import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatInterfaceProblem,
  parseInterface,
  validateInterface,
  type Interface,
} from "../src/index.js";

const EXPORT = "@interface export\n";
const FOREIGN = "@interface foreign\n";

test("accepts an interface whose types are all C-representable", () => {
  const iface = parseInterface(
    [
      "@interface export",
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
  const iface = parseInterface(`${EXPORT}extern func parse(value: Result[Int, Int]) -> Int\n`);
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
    validateInterface(parseInterface(`${EXPORT}extern func noop()\n`)).length,
    0,
  );
  const problems = validateInterface(parseInterface(`${EXPORT}extern func bad(u: Unit) -> Int\n`));
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "unit");
  assert.equal(problems[0]?.position, "param");
});

test("flags an undeclared record type", () => {
  const problems = validateInterface(parseInterface(`${EXPORT}extern func f(b: Buffer) -> Int\n`));
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "unknown");
  assert.equal(problems[0]?.type, "Buffer");
});

test("treats a Str field as C-representable even though the generator cannot marshal it", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Name { text: Str }\nextern func id(n: Name) -> Name\n`,
  );
  assert.deepEqual(validateInterface(iface), []);
});

test("flags a nested @cstruct field problem at its declaration site", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Bad { value: Buffer }\nextern func f(b: Bad) -> Int\n`,
  );
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.symbol, "Bad");
  assert.equal(problems[0]?.position, "field");
  assert.deepEqual(problems[0]?.path, ["value"]);
});

test("detects a @cstruct cycle instead of recursing forever", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record A { b: B }\n@cstruct record B { a: A }\n`,
  );
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "cycle");
  assert.equal(problems[0]?.reason, "@cstruct records must not form a cycle");
});

test("collects every problem in one pass", () => {
  const iface = parseInterface(
    `${EXPORT}extern func a(x: Missing) -> Result[Int, Int]\nextern func b(u: Unit) -> Int\n`,
  );
  const kinds = validateInterface(iface).map((problem) => problem.kind).sort();
  assert.deepEqual(kinds, ["generic", "unit", "unknown"]);
});

test("flags a @cstruct record declared more than once", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Vec2 { x: Float y: Float }\n@cstruct record Vec2 { a: Int b: Int }\n`,
  );
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "duplicate");
  assert.equal(problems[0]?.symbol, "Vec2");
  assert.match(formatInterfaceProblem(problems[0]!), /declared more than once/);
});

test("reports a duplicate @cstruct name only once", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Vec2 { x: Float }\n@cstruct record Vec2 { x: Float }\n@cstruct record Vec2 { x: Float }\n`,
  );
  const duplicates = validateInterface(iface).filter((problem) => problem.kind === "duplicate");
  assert.equal(duplicates.length, 1);
});

test("flags a @cstruct name that collides with a built-in primitive", () => {
  const iface = parseInterface(`${EXPORT}@cstruct record Int { value: Float }\n`);
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "reserved");
  assert.equal(problems[0]?.symbol, "Int");
  assert.match(formatInterfaceProblem(problems[0]!), /collides with the built-in type 'Int'/);
});

test("reports a reserved @cstruct name only once", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Str { a: Int }\n@cstruct record Str { a: Int }\n`,
  );
  const reserved = validateInterface(iface).filter((problem) => problem.kind === "reserved");
  assert.equal(reserved.length, 1);
});

test("flags an extern function declared more than once", () => {
  const iface = parseInterface(`${EXPORT}extern func f() -> Int\nextern func f() -> Int\n`);
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "duplicate");
  assert.equal(problems[0]?.symbol, "f");
  assert.match(formatInterfaceProblem(problems[0]!), /extern function is declared more than once/);
});

test("reports a duplicate extern function name only once", () => {
  const iface = parseInterface(
    `${EXPORT}extern func f() -> Int\nextern func f() -> Int\nextern func f() -> Int\n`,
  );
  const duplicates = validateInterface(iface).filter((problem) => problem.kind === "duplicate");
  assert.equal(duplicates.length, 1);
});

test("formats a problem with symbol, location, and reason", () => {
  const iface = parseInterface(`${EXPORT}extern func parse(value: Missing) -> Int\n`);
  const problem = validateInterface(iface)[0]!;
  const message = formatInterfaceProblem(problem);
  assert.match(message, /^symbol 'parse': parameter 'value' type 'Missing'/);
  assert.match(message, /unknown type 'Missing'/);
});

test("rejects a transfer parameter on the exported boundary", () => {
  const iface = parseInterface(
    [
      "@interface export",
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

test("accepts a transfer parameter in a foreign interface", () => {
  const iface = parseInterface(
    [
      "@interface foreign",
      "@cstruct record Buffer { ptr: Ptr size: Int }",
      "extern func write(transfer frame: Bytes) -> Int",
      "extern func send(transfer text: Str)",
      "extern func install(transfer handle: Ptr)",
      "extern func fill(transfer buffer: Buffer)",
    ].join("\n"),
  );
  assert.deepEqual(validateInterface(iface), []);
});

test("flags a foreign transfer parameter that is not pointer-carrying", () => {
  const iface = parseInterface(`${FOREIGN}extern func take(transfer amount: Int) -> Int\n`);
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "ownership");
  assert.equal(problems[0]?.position, "param");
  assert.match(formatInterfaceProblem(problems[0]!), /requires a pointer-carrying type/);
});

test("rejects a transfer parameter regardless of its type on the exported boundary", () => {
  for (const source of [
    "extern func take(transfer amount: Int) -> Int\n",
    "extern func f(transfer v: Result[Int, Int]) -> Int\n",
    "extern func f(transfer v: Missing) -> Int\n",
  ]) {
    const problems = validateInterface(parseInterface(EXPORT + source));
    assert.ok(
      problems.some((problem) => problem.kind === "ownership" && problem.position === "param"),
      source,
    );
  }
});

test("rejects a transfer return on the exported boundary", () => {
  const iface = parseInterface(
    `${EXPORT}extern func free(ptr: Ptr) -> Unit\nextern func read(p: Str) -> transfer Str release free\n`,
  );
  const problems = validateInterface(iface).filter((problem) => problem.kind === "ownership");
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.position, "return");
  assert.match(formatInterfaceProblem(problems[0]!), /cannot cross an Xz '@export' boundary/);
});

test("rejects a release clause on the exported boundary", () => {
  const iface = parseInterface(
    `${EXPORT}extern func free(ptr: Ptr) -> Unit\nextern func name() -> Str release free\n`,
  );
  const problems = validateInterface(iface).filter((problem) => problem.kind === "release");
  assert.equal(problems.length, 1);
  assert.match(formatInterfaceProblem(problems[0]!), /is not 'transfer'/);
});

test("flags a transfer return that is not pointer-carrying", () => {
  const iface = parseInterface(`${FOREIGN}extern func count() -> transfer Int\n`);
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "ownership");
  assert.equal(problems[0]?.position, "return");
  assert.match(formatInterfaceProblem(problems[0]!), /return type of type 'Int'/);
});

test("accepts a transfer return with a declared Ptr release symbol", () => {
  const iface = parseInterface(
    [
      "@interface foreign",
      "extern func free(ptr: Ptr) -> Unit",
      "extern func strdup(s: Str) -> transfer Str release free",
      "extern func read(p: Str) -> transfer Bytes release free",
    ].join("\n"),
  );
  assert.deepEqual(validateInterface(iface), []);
});

test("flags a transfer return without a release symbol", () => {
  const iface = parseInterface(`${FOREIGN}extern func read(path: Str) -> transfer Str\n`);
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "release");
  assert.equal(problems[0]?.position, "return");
  assert.match(formatInterfaceProblem(problems[0]!), /must declare its deallocator/);
});

test("rejects a release clause on a return that is not transfer", () => {
  const iface = parseInterface(
    `${FOREIGN}extern func free(ptr: Ptr) -> Unit\nextern func name() -> Str release free\n`,
  );
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "release");
  assert.match(formatInterfaceProblem(problems[0]!), /is not 'transfer'/);
});

test("rejects a release symbol that is not declared in the interface", () => {
  const iface = parseInterface(
    `${FOREIGN}extern func read(path: Str) -> transfer Str release missing\n`,
  );
  const problems = validateInterface(iface);
  assert.equal(problems.length, 1);
  assert.equal(problems[0]?.kind, "release");
  assert.match(formatInterfaceProblem(problems[0]!), /not an 'extern func' declared/);
});

test("rejects a release symbol whose signature is not (Ptr) -> Unit", () => {
  for (const release of [
    "extern func free(ptr: Str) -> Unit",
    "extern func free(ptr: Ptr) -> Int",
    "extern func free(ptr: Ptr, len: usize) -> Unit",
    "extern func free(mut ptr: Ptr) -> Unit",
  ]) {
    const iface = parseInterface(
      `${FOREIGN}${release}\nextern func read(p: Str) -> transfer Str release free\n`,
    );
    const releases = validateInterface(iface).filter((problem) => problem.kind === "release");
    assert.equal(releases.length, 1, release);
    assert.match(formatInterfaceProblem(releases[0]!), /must be declared as 'func\(ptr: Ptr\) -> Unit'/);
  }
});

test("rejects a function that releases its own returned buffer", () => {
  const iface = parseInterface(
    `${FOREIGN}extern func read(path: Str) -> transfer Str release read\n`,
  );
  const problems = validateInterface(iface).filter((problem) => problem.kind === "release");
  assert.equal(problems.length, 1);
  assert.match(formatInterfaceProblem(problems[0]!), /cannot release its own/);
});

test("accepts a contracted wrapper with an error map", () => {
  const iface = parseInterface(
    `${EXPORT}@error InvalidAmount = 1\n@error Overflow = 2\nextern func parse(text: Str, mut out: Float) -> Int contract ok 0\n`,
  );
  assert.deepEqual(validateInterface(iface), []);
});

test("rejects a contract return that is not a status code", () => {
  const problems = validateInterface(
    parseInterface(`${EXPORT}extern func parse(text: Str, mut out: Float) -> Float contract ok 0\n`),
  ).filter((problem) => problem.kind === "contract");
  assert.equal(problems.length, 1);
  assert.match(formatInterfaceProblem(problems[0]!), /must return an Int or usize/);
});

test("rejects a contract without exactly one mut out-parameter", () => {
  const none = validateInterface(
    parseInterface(`${EXPORT}extern func parse(text: Str) -> Int contract ok 0\n`),
  ).filter((problem) => problem.kind === "contract");
  assert.equal(none.length, 1);
  assert.match(formatInterfaceProblem(none[0]!), /exactly one 'mut' out-parameter/);

  const two = validateInterface(
    parseInterface(
      `${EXPORT}extern func parse(mut a: Float, mut b: Float) -> Int contract ok 0\n`,
    ),
  ).filter((problem) => problem.kind === "contract");
  assert.equal(two.length, 1);
});

test("rejects a duplicate @error name or code", () => {
  const byName = validateInterface(
    parseInterface(`${EXPORT}@error Bad = 1\n@error Bad = 2\n`),
  ).filter((problem) => problem.kind === "contract");
  assert.equal(byName.length, 1);
  assert.match(formatInterfaceProblem(byName[0]!), /name is declared more than once/);

  const byCode = validateInterface(
    parseInterface(`${EXPORT}@error Bad = 1\n@error Worse = 1\n`),
  ).filter((problem) => problem.kind === "contract");
  assert.equal(byCode.length, 1);
  assert.match(formatInterfaceProblem(byCode[0]!), /code 1 is declared more than once/);
});

test("rejects an ok code that is also declared as an @error code", () => {
  const problems = validateInterface(
    parseInterface(
      `${EXPORT}@error InvalidAmount = 1\nextern func parse(mut out: Float) -> Int contract ok 1\n`,
    ),
  ).filter((problem) => problem.kind === "contract");
  assert.equal(problems.length, 1);
  assert.match(formatInterfaceProblem(problems[0]!), /also declared as an @error code/);
});

test("rejects a contract status return declared transfer", () => {
  const problems = validateInterface(
    parseInterface(
      `${FOREIGN}extern func free(ptr: Ptr) -> Unit\nextern func parse(mut out: Float) -> transfer Ptr release free contract ok 0\n`,
    ),
  ).filter((problem) => problem.kind === "contract");
  assert.ok(
    problems.some((problem) => /cannot also be 'transfer'/.test(formatInterfaceProblem(problem))),
  );
});

test("rejects a parameter that combines mut and transfer", () => {
  const iface: Interface = {
    kind: "foreign",
    cstructs: [],
    errors: [],
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
  const generic = validateInterface(
    parseInterface(`${EXPORT}extern func f(transfer v: Result[Int, Int]) -> Int\n`),
  );
  assert.deepEqual(generic.map((problem) => problem.kind), ["generic", "ownership"]);
  const unknown = validateInterface(parseInterface(`${EXPORT}extern func f(transfer v: Missing) -> Int\n`));
  assert.deepEqual(unknown.map((problem) => problem.kind), ["unknown", "ownership"]);
});