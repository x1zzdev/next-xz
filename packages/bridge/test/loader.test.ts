import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BridgeRuntimeError,
  BridgeSymbolError,
  BridgeVersionError,
  BunFfiBackend,
  loadLibrary,
  manifestFromInterface,
  parseInterface,
  type BunFfiFunction,
  type FfiBackend,
  type LibraryManifest,
  type SymbolDefinition,
} from "../src/index.js";

const manifest = (overrides: Partial<LibraryManifest> = {}): LibraryManifest => {
  const iface = parseInterface("extern func add(a: Int, b: Int) -> Int\n");
  return {
    ...manifestFromInterface(iface, { name: "liborder", path: "liborder.so", xzVersion: "0.1.0" }),
    ...overrides,
  };
};

function backendReturning(symbols: Record<string, unknown>): {
  backend: FfiBackend;
  closed: () => boolean;
} {
  let closed = false;
  return {
    backend: {
      dlopen: (_path: string, _definitions: Readonly<Record<string, SymbolDefinition>>) => ({
        symbols,
        close: () => {
          closed = true;
        },
      }),
    },
    closed: () => closed,
  };
}

test("refuses to bind a library built with a different Xz version", () => {
  const { backend } = backendReturning({ add: () => 0 });
  assert.throws(
    () => loadLibrary(manifest(), { expectedXzVersion: "0.2.0", backend }),
    (error: unknown) =>
      error instanceof BridgeVersionError &&
      error.expected === "0.2.0" &&
      error.actual === "0.1.0",
  );
});

test("reports a required symbol missing from the manifest", () => {
  const { backend } = backendReturning({ add: () => 0 });
  assert.throws(
    () =>
      loadLibrary(manifest(), {
        expectedXzVersion: "0.1.0",
        requiredSymbols: ["subtract"],
        backend,
      }),
    (error: unknown) =>
      error instanceof BridgeSymbolError && error.symbol === "subtract",
  );
});

test("reports a declared symbol the shared object does not export", () => {
  const { backend, closed } = backendReturning({});
  assert.throws(
    () => loadLibrary(manifest(), { expectedXzVersion: "0.1.0", backend }),
    (error: unknown) => error instanceof BridgeSymbolError && error.symbol === "add",
  );
  assert.equal(closed(), true);
});

test("returns the resolved symbols and closes the library", () => {
  const add = () => 3;
  const { backend, closed } = backendReturning({ add });
  const loaded = loadLibrary(manifest(), { expectedXzVersion: "0.1.0", backend });
  assert.equal(loaded.symbols["add"], add);
  assert.equal(loaded.manifest.path, "liborder.so");
  loaded.close();
  assert.equal(closed(), true);
});

test("BunFfiBackend maps neutral FFI types to bun:ffi FFIType values", () => {
  const FFIType = {
    bool: 11,
    int64_t: 7,
    uint64_t: 8,
    double: 9,
    char: 0,
    ptr: 12,
    void: 13,
  };
  let captured: Record<string, BunFfiFunction> | undefined;
  const backend = new BunFfiBackend({
    FFIType,
    dlopen: (_path, symbols) => {
      captured = symbols;
      return { symbols: { add: () => 0 }, close: () => {} };
    },
  });
  const library = backend.dlopen("liborder.so", {
    add: { args: ["int64", "uint64"], returns: "void" },
  });
  assert.deepEqual(captured?.["add"], { args: [7, 8], returns: 13 });
  assert.equal(typeof library.symbols["add"], "function");
});

test("BunFfiBackend refuses a struct passed by value", () => {
  const backend = new BunFfiBackend({ FFIType: { void: 13 }, dlopen: () => ({ symbols: {}, close: () => {} }) });
  assert.throws(
    () =>
      backend.dlopen("liborder.so", {
        parse: {
          args: [
            {
              kind: "struct",
              name: "XzStr",
              fields: [
                { name: "ptr", type: "ptr" },
                { name: "len", type: "uint64" },
              ],
            },
          ],
          returns: "void",
        },
      }),
    BridgeRuntimeError,
  );
});
