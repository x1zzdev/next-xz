import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BridgeRuntimeError,
  detectPlatform,
  loadPlatformLibrary,
  manifestFromInterface,
  parseInterface,
  type LibraryManifest,
} from "../src/index.js";

const manifest = (): LibraryManifest => {
  const iface = parseInterface("@interface export\nextern func add(a: Int, b: Int) -> Int\n");
  return manifestFromInterface(iface, { name: "liborder", path: "liborder.so", xzVersion: "0.1.0" });
};

test("detectPlatform reports bun only when the Bun global is present", () => {
  assert.equal(detectPlatform({ Bun: {} }), "bun");
  assert.equal(detectPlatform({}), "node");
});

test("loadPlatformLibrary selects the koffi loader when Bun is absent", async () => {
  await assert.rejects(
    loadPlatformLibrary(manifest(), { expectedXzVersion: "0.1.0" }),
    (error: unknown) =>
      error instanceof BridgeRuntimeError && error.message.includes("koffi"),
  );
});

test("loadPlatformLibrary selects the bun:ffi loader when the Bun global is present", async () => {
  const globals = globalThis as { Bun?: unknown };
  globals.Bun = {};
  try {
    await assert.rejects(
      loadPlatformLibrary(manifest(), { expectedXzVersion: "0.1.0" }),
      (error: unknown) =>
        error instanceof BridgeRuntimeError && error.message.includes("bun:ffi"),
    );
  } finally {
    delete globals.Bun;
  }
});