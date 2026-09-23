import { BridgeRuntimeError } from "./errors.js";

export interface XzPointerValue {
  readonly ptr: Uint8Array;
  readonly len: number;
  /**
   * The FFI backend's original pointer value, preserved when the backend had to
   * decode `ptr` into a byte view. A `transfer` return must release the original
   * allocation, not a copy, so the generated binding passes this back to the
   * release symbol; it falls back to `ptr` when the backend exposes bytes
   * directly.
   */
  readonly address?: unknown;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Normalizes a value crossing the ABI as an Xz `Int`/`usize` into the exact
 * `bigint` the binding promises.
 *
 * The 64-bit ABI range cannot be held by a JavaScript `number` above 2^53, so
 * the binding never accepts an unsafe number: a safe-integer number (a backend
 * that returns small 64-bit values as `number`) is widened exactly, and any
 * other value is a hard error rather than a lossy cast.
 */
export function asXzInt(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  throw new BridgeRuntimeError(
    `expected a 64-bit integer (bigint, or a safe-integer number from the FFI backend), received ${describe(value)}`,
  );
}

function describe(value: unknown): string {
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

export function encodeStr(value: string): XzPointerValue {
  const bytes = encoder.encode(value);
  return { ptr: bytes, len: bytes.length };
}

export function encodeBytes(value: Uint8Array): XzPointerValue {
  return { ptr: value, len: value.length };
}

export function decodeStr(value: XzPointerValue): string {
  return decoder.decode(byteView(value));
}

export function decodeBytes(value: XzPointerValue): Uint8Array {
  return byteView(value).slice();
}

function byteView(value: XzPointerValue): Uint8Array {
  if (value === null || typeof value !== "object") {
    throw new BridgeRuntimeError("expected an XzStr/XzBytes value with 'ptr' and 'len'");
  }
  const { ptr, len } = value;
  if (!(ptr instanceof Uint8Array)) {
    throw new BridgeRuntimeError(
      "XzStr/XzBytes 'ptr' is not a byte view; the FFI backend must expose the buffer, not a raw pointer",
    );
  }
  if (!Number.isInteger(len) || len < 0 || len > ptr.length) {
    throw new BridgeRuntimeError(
      `XzStr/XzBytes 'len' (${String(len)}) is out of range for the ${ptr.length}-byte buffer`,
    );
  }
  return ptr.subarray(0, len);
}