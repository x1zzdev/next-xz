import assert from "node:assert/strict";
import { test } from "node:test";

import { XzintParseError, parseInterface } from "../src/index.js";

const EXPORT = "@interface export\n";
const FOREIGN = "@interface foreign\n";

const LIBCURL = `@interface foreign
extern func curl_easy_init() -> Ptr
extern func curl_easy_setopt(handle: Ptr, option: Int, param: Ptr) -> Int
extern func curl_easy_cleanup(handle: Ptr)

@cstruct record curl_slist {
    data: Str
    next: Ptr
}
`;

test("parses an @interface export marker", () => {
  const iface = parseInterface(EXPORT);
  assert.equal(iface.kind, "export");
});

test("parses an @interface foreign marker", () => {
  const iface = parseInterface(FOREIGN);
  assert.equal(iface.kind, "foreign");
});

test("rejects a missing interface-kind marker", () => {
  assert.throws(
    () => parseInterface("extern func noop()\n", "lib.xzint"),
    (error: unknown) =>
      error instanceof XzintParseError && error.message.includes("must open with exactly one"),
  );
});

test("rejects an unknown interface kind", () => {
  assert.throws(
    () => parseInterface("@interface mixed\nextern func noop()\n", "lib.xzint"),
    (error: unknown) =>
      error instanceof XzintParseError &&
      error.message.includes("expected 'export' or 'foreign'"),
  );
});

test("rejects a non-interface annotation before the marker", () => {
  assert.throws(
    () => parseInterface("@cstruct record Buffer {\n    ptr: Ptr\n}\n", "lib.xzint"),
    (error: unknown) =>
      error instanceof XzintParseError &&
      error.message.includes("expected '@interface export' or '@interface foreign'"),
  );
});

test("rejects a second interface-kind marker", () => {
  assert.throws(
    () => parseInterface(`${EXPORT}${FOREIGN}extern func noop()\n`, "lib.xzint"),
    (error: unknown) =>
      error instanceof XzintParseError && error.message.includes("must appear exactly once"),
  );
});

test("parses extern funcs and @cstruct records", () => {
  const iface = parseInterface(LIBCURL, "libcurl.xzint");

  assert.equal(iface.kind, "foreign");
  assert.equal(iface.funcs.length, 3);
  assert.equal(iface.funcs[0]?.name, "curl_easy_init");
  assert.deepEqual(iface.funcs[0]?.returnType, { kind: "named", name: "Ptr" });
  assert.equal(iface.funcs[1]?.params.length, 3);
  assert.equal(iface.funcs[1]?.params[1]?.name, "option");
  assert.deepEqual(iface.funcs[1]?.params[1]?.type, { kind: "named", name: "Int" });

  assert.equal(iface.cstructs.length, 1);
  assert.equal(iface.cstructs[0]?.name, "curl_slist");
  assert.deepEqual(
    iface.cstructs[0]?.fields.map((field) => field.name),
    ["data", "next"],
  );
});

test("defaults a missing return type to Unit", () => {
  const iface = parseInterface(`${EXPORT}extern func noop()\nextern func cleanup(handle: Ptr)\n`);
  assert.deepEqual(iface.funcs[0]?.returnType, { kind: "named", name: "Unit" });
  assert.deepEqual(iface.funcs[1]?.returnType, { kind: "named", name: "Unit" });
});

test("parses mut params", () => {
  const iface = parseInterface(`${EXPORT}extern func parse_amount(text: Str, mut out: Float) -> Int\n`);
  assert.equal(iface.funcs[0]?.params[0]?.mutable, false);
  assert.equal(iface.funcs[0]?.params[1]?.mutable, true);
  assert.deepEqual(iface.funcs[0]?.params[1]?.type, { kind: "named", name: "Float" });
});

test("parses transfer params", () => {
  const iface = parseInterface(`${FOREIGN}extern func write(transfer frame: Bytes) -> Int\n`);
  assert.equal(iface.funcs[0]?.params[0]?.transfer, true);
  assert.equal(iface.funcs[0]?.params[0]?.mutable, false);
  assert.deepEqual(iface.funcs[0]?.params[0]?.type, { kind: "named", name: "Bytes" });
});

test("parses transfer return", () => {
  const iface = parseInterface(`${FOREIGN}extern func read(path: Str) -> transfer Str\n`);
  assert.equal(iface.funcs[0]?.transferReturn, true);
  assert.deepEqual(iface.funcs[0]?.returnType, { kind: "named", name: "Str" });
});

test("defaults transferReturn to false", () => {
  const iface = parseInterface(`${EXPORT}extern func id(n: Int) -> Int\n`);
  assert.equal(iface.funcs[0]?.transferReturn, false);
});

test("parses a release symbol on a transfer return", () => {
  const iface = parseInterface(
    `${FOREIGN}extern func free(ptr: Ptr) -> Unit\nextern func strdup(s: Str) -> transfer Str release free\n`,
  );
  assert.equal(iface.funcs[1]?.transferReturn, true);
  assert.equal(iface.funcs[1]?.release, "free");
  assert.deepEqual(iface.funcs[1]?.returnType, { kind: "named", name: "Str" });
});

test("defaults a missing release symbol to absent", () => {
  const iface = parseInterface(`${FOREIGN}extern func read(path: Str) -> transfer Str\n`);
  assert.equal(iface.funcs[0]?.release, undefined);
});

test("parses generic type arguments as non-C-representable shape", () => {
  const iface = parseInterface(`${EXPORT}extern func f(x: Result[Int, Int]) -> Int\n`);
  assert.deepEqual(iface.funcs[0]?.params[0]?.type, {
    kind: "generic",
    name: "Result",
    args: [
      { kind: "named", name: "Int" },
      { kind: "named", name: "Int" },
    ],
  });
});

test("ignores line, doc, and block comments", () => {
  const source = `@interface export
// a line comment
/// @intent doc comment
/* a block
   comment */
extern func noop() /* inline */ -> Unit
`;
  const iface = parseInterface(source);
  assert.equal(iface.funcs.length, 1);
  assert.deepEqual(iface.funcs[0]?.returnType, { kind: "named", name: "Unit" });
});

test("rejects declarations outside extern func and @cstruct record", () => {
  assert.throws(
    () => parseInterface(`${EXPORT}func helper() -> Int\n`, "lib.xzint"),
    (error: unknown) =>
      error instanceof XzintParseError && error.message.includes("may only declare"),
  );
  assert.throws(
    () => parseInterface(`${EXPORT}record Buffer {\n    ptr: Ptr\n}\n`, "lib.xzint"),
    XzintParseError,
  );
});

test("rejects a function body as outside the .xzint subset", () => {
  assert.throws(
    () => parseInterface(`${EXPORT}func helper() -> Int {\n    1\n}\n`, "lib.xzint"),
    XzintParseError,
  );
});

test("rejects numeric and string literals as outside the .xzint subset", () => {
  assert.throws(
    () => parseInterface(`${EXPORT}extern func f(n: Int) -> Int\nconst LIMIT = 42\n`, "lib.xzint"),
    XzintParseError,
  );
  assert.throws(
    () => parseInterface(`${EXPORT}extern func f(s: Str) -> Int\nconst NAME = "lib"\n`, "lib.xzint"),
    XzintParseError,
  );
});

test("rejects generic extern funcs", () => {
  assert.throws(
    () => parseInterface(`${EXPORT}extern func id[T](x: T) -> T\n`),
    (error: unknown) =>
      error instanceof XzintParseError && error.message.includes("not C-representable"),
  );
});

test("rejects union types", () => {
  assert.throws(
    () => parseInterface(`${EXPORT}extern func f(x: Int | Float) -> Int\n`),
    (error: unknown) =>
      error instanceof XzintParseError && error.message.includes("union types"),
  );
});

test("reports position on unexpected characters", () => {
  assert.throws(
    () => parseInterface(`${EXPORT}extern func f(x: Int) -> Int;\n`, "lib.xzint"),
    (error: unknown) =>
      error instanceof XzintParseError &&
      error.file === "lib.xzint" &&
      error.line === 2 &&
      error.column === 29,
  );
});