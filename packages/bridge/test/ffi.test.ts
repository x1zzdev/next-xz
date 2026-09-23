import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BridgeDefinitionError,
  manifestFromInterface,
  mapXzTypeToFfi,
  parseInterface,
  type CStruct,
  type XzType,
} from "../src/index.js";

const named = (name: string): XzType => ({ kind: "named", name });
const noStructs: ReadonlyMap<string, CStruct> = new Map();

test("maps C-representable scalars to backend-neutral FFI types", () => {
  assert.equal(mapXzTypeToFfi(named("Bool"), noStructs), "bool");
  assert.equal(mapXzTypeToFfi(named("Int"), noStructs), "int64");
  assert.equal(mapXzTypeToFfi(named("usize"), noStructs), "uint64");
  assert.equal(mapXzTypeToFfi(named("Float"), noStructs), "double");
  assert.equal(mapXzTypeToFfi(named("Char"), noStructs), "char");
  assert.equal(mapXzTypeToFfi(named("Ptr"), noStructs), "ptr");
  assert.equal(mapXzTypeToFfi(named("Unit"), noStructs, "return"), "void");
});

test("maps Str and Bytes to two-field pointer/length structs", () => {
  assert.deepEqual(mapXzTypeToFfi(named("Str"), noStructs), {
    kind: "struct",
    name: "XzStr",
    fields: [
      { name: "ptr", type: "ptr" },
      { name: "len", type: "uint64" },
    ],
  });
  assert.deepEqual(mapXzTypeToFfi(named("Bytes"), noStructs), {
    kind: "struct",
    name: "XzBytes",
    fields: [
      { name: "ptr", type: "ptr" },
      { name: "len", type: "uint64" },
    ],
  });
});

test("maps a @cstruct record, including nested records", () => {
  const iface = parseInterface(
    "@cstruct record Point {\n    x: Int\n    y: Int\n}\n@cstruct record Line {\n    a: Point\n    b: Point\n}\n",
  );
  const cstructs = new Map(iface.cstructs.map((cstruct) => [cstruct.name, cstruct]));
  assert.deepEqual(mapXzTypeToFfi(named("Line"), cstructs), {
    kind: "struct",
    name: "Line",
    fields: [
      {
        name: "a",
        type: {
          kind: "struct",
          name: "Point",
          fields: [
            { name: "x", type: "int64" },
            { name: "y", type: "int64" },
          ],
        },
      },
      {
        name: "b",
        type: {
          kind: "struct",
          name: "Point",
          fields: [
            { name: "x", type: "int64" },
            { name: "y", type: "int64" },
          ],
        },
      },
    ],
  });
});

test("manifest validation rejects a cyclic @cstruct before mapping", () => {
  const iface = parseInterface("@cstruct record A {\n    b: B\n}\n@cstruct record B {\n    a: A\n}\n");
  assert.throws(
    () => manifestFromInterface(iface, { name: "lib", path: "lib.so", xzVersion: "0.1.0" }),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("must not form a cycle"),
  );
});

test("manifest validation rejects Unit parameters and generics before mapping", () => {
  const unitParam = parseInterface("extern func f(u: Unit) -> Int\n");
  assert.throws(
    () => manifestFromInterface(unitParam, { name: "lib", path: "lib.so", xzVersion: "0.1.0" }),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("Unit is allowed only as a return type"),
  );
  const generic = parseInterface("extern func f(v: Result[Int, Int]) -> Int\n");
  assert.throws(
    () => manifestFromInterface(generic, { name: "lib", path: "lib.so", xzVersion: "0.1.0" }),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("has no C declaration"),
  );
});

test("manifest validation rejects transfer of a non-pointer-carrying type", () => {
  const iface = parseInterface("extern func take(transfer amount: Int) -> Int\n");
  assert.throws(
    () => manifestFromInterface(iface, { name: "lib", path: "lib.so", xzVersion: "0.1.0" }),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("pointer-carrying type"),
  );
});

test("builds a manifest: mut params become pointers, returns keep their type", () => {
  const iface = parseInterface("extern func parse_amount(text: Str, mut out: Float) -> Int\n");
  const manifest = manifestFromInterface(iface, {
    name: "liborder",
    path: ".next-xz/liborder.so",
    xzVersion: "0.1.0",
  });
  assert.equal(manifest.xzVersion, "0.1.0");
  assert.deepEqual(manifest.symbols["parse_amount"], {
    args: [
      {
        kind: "struct",
        name: "XzStr",
        fields: [
          { name: "ptr", type: "ptr" },
          { name: "len", type: "uint64" },
        ],
      },
      "ptr",
    ],
    returns: "int64",
  });
});

test("maps only a validated type: an unvalidated call throws the internal invariant", () => {
  const invariant = (error: unknown) =>
    error instanceof BridgeDefinitionError &&
    error.message.includes("must pass validateInterface before mapping");
  assert.throws(() => mapXzTypeToFfi(named("Missing"), noStructs), invariant);
  assert.throws(() => mapXzTypeToFfi(named("Unit"), noStructs), invariant);
  assert.throws(
    () => mapXzTypeToFfi({ kind: "generic", name: "Result", args: [] }, noStructs),
    invariant,
  );
});

test("rejects a duplicate symbol in the interface", () => {
  const iface = parseInterface("extern func f() -> Int\nextern func f() -> Int\n");
  assert.throws(
    () =>
      manifestFromInterface(iface, { name: "lib", path: "lib.so", xzVersion: "0.1.0" }),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("extern function is declared more than once"),
  );
});
