import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BridgeRuntimeError,
  decodeBytes,
  decodeStr,
  encodeBytes,
  encodeStr,
} from "../src/index.js";

test("encodeStr writes UTF-8 bytes and reports their length", () => {
  const value = encodeStr("héllo");
  assert.ok(value.ptr instanceof Uint8Array);
  assert.deepEqual([...value.ptr], [...Buffer.from("héllo", "utf8")]);
  assert.equal(value.len, value.ptr.length);
});

test("decodeStr reads len bytes and ignores the rest of the buffer", () => {
  const buffer = Buffer.from("hello world", "utf8");
  assert.equal(decodeStr({ ptr: buffer, len: 5 }), "hello");
});

test("round-trips a string through encodeStr and decodeStr", () => {
  assert.equal(decodeStr(encodeStr("주문 합계")), "주문 합계");
});

test("encodeBytes borrows the given view without copying", () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const value = encodeBytes(bytes);
  assert.equal(value.ptr, bytes);
  assert.equal(value.len, 3);
});

test("decodeBytes returns an independent copy of len bytes", () => {
  const buffer = new Uint8Array([1, 2, 3, 4]);
  const decoded = decodeBytes({ ptr: buffer, len: 2 });
  assert.deepEqual([...decoded], [1, 2]);
  buffer[0] = 9;
  assert.deepEqual([...decoded], [1, 2]);
});

test("rejects a pointer that is not a byte view", () => {
  assert.throws(
    () => decodeBytes({ ptr: 0x1000 as unknown as Uint8Array, len: 4 }),
    (error: unknown) =>
      error instanceof BridgeRuntimeError && error.message.includes("byte view"),
  );
});

test("rejects a length beyond the backing buffer", () => {
  assert.throws(
    () => decodeStr({ ptr: new Uint8Array([1, 2]), len: 3 }),
    (error: unknown) =>
      error instanceof BridgeRuntimeError && error.message.includes("out of range"),
  );
});