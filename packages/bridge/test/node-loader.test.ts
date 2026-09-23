import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BridgeRuntimeError,
  KoffiBackend,
  loadKoffiBackend,
  manifestFromInterface,
  parseInterface,
  type KoffiFieldType,
  type KoffiModule,
  type KoffiSignature,
} from "../src/index.js";

interface FakeKoffi {
  readonly module: KoffiModule;
  readonly registrations: Array<Record<string, unknown>>;
  readonly signatures: KoffiSignature[];
  readonly loadedPaths: string[];
}

function fakeKoffi(): FakeKoffi {
  const registrations: Array<Record<string, unknown>> = [];
  const signatures: KoffiSignature[] = [];
  const loadedPaths: string[] = [];
  return {
    registrations,
    signatures,
    loadedPaths,
    module: {
      load: (path) => {
        loadedPaths.push(path);
        return {
          func: (name, ret, args) => {
            signatures.push({ name, ret, args });
            return () => 0;
          },
          close: () => {},
        };
      },
      struct: (name, fields: Readonly<Record<string, KoffiFieldType>>) => {
        const token = { name };
        registrations.push({ name, fields, token });
        return token;
      },
      decode: () => new Uint8Array(),
    },
  };
}

test("KoffiBackend maps neutral FFI scalars to a koffi signature", () => {
  const koffi = fakeKoffi();
  const backend = new KoffiBackend(koffi.module);
  const library = backend.dlopen("liborder.so", {
    add: { args: ["int64", "uint64"], returns: "void" },
  });
  assert.deepEqual(koffi.signatures, [
    { name: "add", ret: "void", args: ["int64_t", "uint64_t"] },
  ]);
  assert.equal(typeof library.symbols["add"], "function");
});

test("KoffiBackend registers an XzStr struct and passes it by value", () => {
  const koffi = fakeKoffi();
  const backend = new KoffiBackend(koffi.module);
  const iface = parseInterface("@interface export\nextern func show(text: Str) -> Int\n");
  const manifest = manifestFromInterface(iface, {
    name: "liborder",
    path: "liborder.so",
    xzVersion: "0.1.0",
  });
  backend.dlopen(manifest.path, manifest.symbols);

  const token = koffi.registrations[0]?.["token"];
  assert.deepEqual(koffi.registrations[0]?.["fields"], { ptr: "void *", len: "uint64_t" });
  assert.deepEqual(koffi.signatures, [{ name: "show", ret: "int64_t", args: [token] }]);
});

test("KoffiBackend registers nested @cstruct records inner-first and reuses tokens", () => {
  const koffi = fakeKoffi();
  const backend = new KoffiBackend(koffi.module);
  const iface = parseInterface(
    "@interface export\n@cstruct record Point {\n    x: Int\n    y: Int\n}\n@cstruct record Line {\n    a: Point\n    b: Point\n}\nextern func midline(line: Line) -> Point\n",
  );
  const manifest = manifestFromInterface(iface, {
    name: "liborder",
    path: "liborder.so",
    xzVersion: "0.1.0",
  });
  backend.dlopen(manifest.path, manifest.symbols);

  assert.deepEqual(
    koffi.registrations.map((entry) => entry["name"]),
    ["Point", "Line"],
  );
  const point = koffi.registrations[0]?.["token"];
  const lineFields = koffi.registrations[1]?.["fields"] as Record<string, unknown>;
  assert.equal(lineFields["a"], point);
  assert.equal(lineFields["b"], point);
  const line = koffi.registrations[1]?.["token"];
  assert.deepEqual(koffi.signatures, [{ name: "midline", ret: point, args: [line] }]);
});

test("KoffiBackend registers each struct once across symbols", () => {
  const koffi = fakeKoffi();
  const backend = new KoffiBackend(koffi.module);
  const iface = parseInterface("@interface export\nextern func a(text: Str) -> Int\nextern func b(text: Str) -> Int\n");
  const manifest = manifestFromInterface(iface, {
    name: "liborder",
    path: "liborder.so",
    xzVersion: "0.1.0",
  });
  backend.dlopen(manifest.path, manifest.symbols);
  assert.equal(koffi.registrations.length, 1);
});

test("KoffiBackend closes the loaded library", () => {
  let closed = false;
  const backend = new KoffiBackend({
    load: (_path) => ({
      func: () => () => 0,
      close: () => {
        closed = true;
      },
    }),
    struct: () => ({}),
    decode: () => new Uint8Array(),
  });
  const library = backend.dlopen("liborder.so", { add: { args: [], returns: "int64" } });
  library.close();
  assert.equal(closed, true);
});

test("loadKoffiBackend reports a missing koffi package", async (t) => {
  let available = true;
  try {
    await import("koffi");
  } catch {
    available = false;
  }
  if (available) {
    t.skip("koffi is installed in this environment");
    return;
  }
  await assert.rejects(loadKoffiBackend(), BridgeRuntimeError);
});