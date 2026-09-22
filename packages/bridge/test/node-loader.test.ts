import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BridgeRuntimeError,
  KoffiBackend,
  loadKoffiBackend,
  type KoffiSignature,
} from "../src/index.js";

test("KoffiBackend maps neutral FFI types to a koffi signature", () => {
  const captured: KoffiSignature[] = [];
  const backend = new KoffiBackend({
    load: (_path) => ({
      func: (signature) => {
        captured.push(signature);
        return () => 0;
      },
      close: () => {},
    }),
  });
  const library = backend.dlopen("liborder.so", {
    add: { args: ["int64", "uint64"], returns: "void" },
  });
  assert.deepEqual(captured, [{ ret: "void", args: ["int64_t", "uint64_t"] }]);
  assert.equal(typeof library.symbols["add"], "function");
});

test("KoffiBackend refuses to bind a struct passed by value", () => {
  let loaded = false;
  const backend = new KoffiBackend({
    load: (_path) => {
      loaded = true;
      return { func: () => () => 0, close: () => {} };
    },
  });
  assert.throws(
    () =>
      backend.dlopen("liborder.so", {
        parse: {
          args: [{ kind: "struct", name: "XzStr", fields: ["ptr", "uint64"] }],
          returns: "void",
        },
      }),
    (error: unknown) =>
      error instanceof BridgeRuntimeError && error.message.includes("XzStr"),
  );
  assert.equal(loaded, false);
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