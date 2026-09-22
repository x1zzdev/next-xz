import { BridgeRuntimeError } from "./errors.js";

export interface XzPointerValue {
  readonly ptr: Uint8Array;
  readonly len: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

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