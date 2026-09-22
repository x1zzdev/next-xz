import assert from "node:assert/strict";
import { test } from "node:test";

import { XzintParseError, parseInterface } from "../src/index.js";

const LIBCURL = `extern func curl_easy_init() -> Ptr
extern func curl_easy_setopt(handle: Ptr, option: Int, param: Ptr) -> Int
extern func curl_easy_cleanup(handle: Ptr)

@cstruct record curl_slist {
    data: Str
    next: Ptr
}
`;

test("parses extern funcs and @cstruct records", () => {
  const iface = parseInterface(LIBCURL, "libcurl.xzint");

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
  const iface = parseInterface("extern func noop()\nextern func cleanup(handle: Ptr)\n");
  assert.deepEqual(iface.funcs[0]?.returnType, { kind: "named", name: "Unit" });
  assert.deepEqual(iface.funcs[1]?.returnType, { kind: "named", name: "Unit" });
});

test("parses mut params", () => {
  const iface = parseInterface("extern func parse_amount(text: Str, mut out: Float) -> Int\n");
  assert.equal(iface.funcs[0]?.params[0]?.mutable, false);
  assert.equal(iface.funcs[0]?.params[1]?.mutable, true);
  assert.deepEqual(iface.funcs[0]?.params[1]?.type, { kind: "named", name: "Float" });
});

test("parses generic type arguments as non-C-representable shape", () => {
  const iface = parseInterface("extern func f(x: Result[Int, Int]) -> Int\n");
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
  const source = `// a line comment
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
    () => parseInterface("func helper() -> Int\n", "lib.xzint"),
    (error: unknown) =>
      error instanceof XzintParseError && error.message.includes("may only declare"),
  );
  assert.throws(
    () => parseInterface("record Buffer {\n    ptr: Ptr\n}\n", "lib.xzint"),
    XzintParseError,
  );
});

test("rejects a function body as outside the .xzint subset", () => {
  assert.throws(
    () => parseInterface("func helper() -> Int {\n    1\n}\n", "lib.xzint"),
    XzintParseError,
  );
});

test("rejects generic extern funcs", () => {
  assert.throws(
    () => parseInterface("extern func id[T](x: T) -> T\n"),
    (error: unknown) =>
      error instanceof XzintParseError && error.message.includes("not C-representable"),
  );
});

test("rejects union types", () => {
  assert.throws(
    () => parseInterface("extern func f(x: Int | Float) -> Int\n"),
    (error: unknown) =>
      error instanceof XzintParseError && error.message.includes("union types"),
  );
});

test("reports position on unexpected characters", () => {
  assert.throws(
    () => parseInterface("extern func f(x: Int) -> Int;\n", "lib.xzint"),
    (error: unknown) =>
      error instanceof XzintParseError &&
      error.file === "lib.xzint" &&
      error.line === 1 &&
      error.column === 29,
  );
});
