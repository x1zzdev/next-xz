import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BridgeRuntimeError,
  BridgeSymbolError,
  BridgeVersionError,
  compileWasm,
  loadWasmLibrary,
  manifestFromInterface,
  parseInterface,
  type LibraryManifest,
} from "../src/index.js";

function leb(value: number): number[] {
  const out: number[] = [];
  let n = value;
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

function section(id: number, payload: readonly number[]): number[] {
  return [id, ...leb(payload.length), ...payload];
}

function ascii(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0));
}

/**
 * A module with `add(i64, i64) -> i64`, `echo_bool(i32) -> i32`, and
 * `echo_char(i32) -> i32` (the last two share one function body). Hand-encoded
 * so the test needs no wat2wasm toolchain.
 */
function fixtureBytes(): Uint8Array {
  const magic = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const typeSection = section(1, [
    0x02,
    0x60, 0x02, 0x7e, 0x7e, 0x01, 0x7e,
    0x60, 0x01, 0x7f, 0x01, 0x7f,
  ]);
  const functionSection = section(3, [0x02, 0x00, 0x01]);
  const exportSection = section(7, [
    0x03,
    0x03, ...ascii("add"), 0x00, 0x00,
    0x09, ...ascii("echo_bool"), 0x00, 0x01,
    0x09, ...ascii("echo_char"), 0x00, 0x01,
  ]);
  const codeSection = section(10, [
    0x02,
    ...leb(7), 0x00, 0x20, 0x00, 0x20, 0x01, 0x7c, 0x0b,
    ...leb(4), 0x00, 0x20, 0x00, 0x0b,
  ]);
  return new Uint8Array([
    ...magic,
    ...typeSection,
    ...functionSection,
    ...exportSection,
    ...codeSection,
  ]);
}

function manifest(source: string): LibraryManifest {
  const iface = parseInterface(`@interface export\n${source}`);
  return manifestFromInterface(iface, {
    name: "libscalar",
    path: "libscalar.wasm",
    xzVersion: "0.1.0",
  });
}

test("WasmBackend binds a scalar module and marshals Bool/Char/Int", () => {
  const loaded = loadWasmLibrary(
    manifest(
      [
        "extern func add(a: Int, b: Int) -> Int",
        "extern func echo_bool(value: Bool) -> Bool",
        "extern func echo_char(value: Char) -> Char",
        "",
      ].join("\n"),
    ),
    { expectedXzVersion: "0.1.0", module: compileWasm(fixtureBytes()) },
  );

  const symbols = loaded.symbols as Record<string, (...args: unknown[]) => unknown>;
  assert.equal(symbols["add"]!(2n, 3n), 5n);
  assert.equal(symbols["echo_bool"]!(true), true);
  assert.equal(symbols["echo_bool"]!(false), false);
  assert.equal(symbols["echo_char"]!("A"), "A");
});

test("loadWasmLibrary reports a symbol missing from the Wasm module", () => {
  assert.throws(
    () =>
      loadWasmLibrary(manifest("extern func absent() -> Int\n"), {
        expectedXzVersion: "0.1.0",
        module: compileWasm(fixtureBytes()),
      }),
    (error: unknown) => error instanceof BridgeSymbolError && error.symbol === "absent",
  );
});

test("WasmBackend rejects a non-scalar signature instead of degrading it", () => {
  assert.throws(
    () =>
      loadWasmLibrary(manifest("extern func greet(name: Str) -> Unit\n"), {
        expectedXzVersion: "0.1.0",
        module: compileWasm(fixtureBytes()),
      }),
    (error: unknown) =>
      error instanceof BridgeRuntimeError && error.message.includes("only scalar signatures"),
  );
});

test("loadWasmLibrary pins the Xz version before instantiating", () => {
  assert.throws(
    () =>
      loadWasmLibrary(manifest("extern func add(a: Int, b: Int) -> Int\n"), {
        expectedXzVersion: "9.9.9",
        module: compileWasm(fixtureBytes()),
      }),
    BridgeVersionError,
  );
});