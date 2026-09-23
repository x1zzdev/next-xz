import assert from "node:assert/strict";
import { test } from "node:test";

import { cstructNames, mapTypeToTs, parseInterface, renderXzType, type XzType } from "../src/index.js";

const named = (name: string): XzType => ({ kind: "named", name });
const empty = new Set<string>();

test("maps C-representable scalars per ARCHITECTURE section 3", () => {
  assert.equal(mapTypeToTs(named("Bool"), empty), "boolean");
  assert.equal(mapTypeToTs(named("Int"), empty), "number");
  assert.equal(mapTypeToTs(named("usize"), empty), "number");
  assert.equal(mapTypeToTs(named("Float"), empty), "number");
  assert.equal(mapTypeToTs(named("Char"), empty), "string");
  assert.equal(mapTypeToTs(named("Str"), empty), "string");
  assert.equal(mapTypeToTs(named("Bytes"), empty), "Uint8Array");
  assert.equal(mapTypeToTs(named("Ptr"), empty), "unknown");
});

test("maps a @cstruct record to its TypeScript interface name", () => {
  const iface = parseInterface("@cstruct record Color {\n    r: usize\n    g: usize\n}\n");
  const cstructs = cstructNames(iface);
  assert.equal(mapTypeToTs(named("Color"), cstructs), "Color");
});

test("maps Unit to void only as a return type", () => {
  assert.equal(mapTypeToTs(named("Unit"), empty, "return"), "void");
});

test("renders a generic type for diagnostics", () => {
  const result: XzType = { kind: "generic", name: "Result", args: [named("Int"), named("Int")] };
  assert.equal(renderXzType(result), "Result[Int, Int]");
});
