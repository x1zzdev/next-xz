import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BridgeDefinitionError,
  NotCRepresentableError,
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

test("rejects a cyclic @cstruct record", () => {
  const iface = parseInterface("@cstruct record A {\n    b: B\n}\n@cstruct record B {\n    a: A\n}\n");
  const cstructs = new Map(iface.cstructs.map((cstruct) => [cstruct.name, cstruct]));
  assert.throws(
    () => mapXzTypeToFfi(named("A"), cstructs),
    (error: unknown) =>
      error instanceof NotCRepresentableError && error.message.includes("cycle"),
  );
});

test("rejects Unit as a parameter and generics", () => {
  assert.throws(() => mapXzTypeToFfi(named("Unit"), noStructs, "param"), NotCRepresentableError);
  const result: XzType = { kind: "generic", name: "Result", args: [named("Int"), named("Int")] };
  assert.throws(() => mapXzTypeToFfi(result, noStructs), NotCRepresentableError);
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

test("rejects a duplicate symbol in the interface", () => {
  const iface = parseInterface("extern func f() -> Int\nextern func f() -> Int\n");
  assert.throws(
    () =>
      manifestFromInterface(iface, { name: "lib", path: "lib.so", xzVersion: "0.1.0" }),
    BridgeDefinitionError,
  );
});
