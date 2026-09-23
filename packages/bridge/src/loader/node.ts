import { BridgeRuntimeError } from "../errors.js";
import type { LibraryManifest, SymbolDefinition } from "../ffi/manifest.js";
import type { FfiScalar, FfiStruct, FfiType } from "../ffi/types.js";
import type { FfiBackend, FfiLibrary } from "./ffi-backend.js";
import { loadLibrary, type LoadOptions, type LoadedLibrary } from "./load.js";

export type KoffiType = object;

export type KoffiFieldType = string | KoffiType;

export interface KoffiSignature {
  readonly name: string;
  readonly ret: KoffiFieldType;
  readonly args: readonly KoffiFieldType[];
}

export interface KoffiFunction {
  (...args: unknown[]): unknown;
}

export interface KoffiLibrary {
  func(name: string, returns: KoffiFieldType, args: readonly KoffiFieldType[]): KoffiFunction;
  close?(): void;
}

export interface KoffiModule {
  load(path: string): KoffiLibrary;
  struct(name: string, fields: Readonly<Record<string, KoffiFieldType>>): KoffiType;
  decode(pointer: unknown, type: string, length: number): Uint8Array;
}

const KOFFI_SCALAR: Readonly<Record<FfiScalar, string>> = {
  bool: "bool",
  int64: "int64_t",
  uint64: "uint64_t",
  double: "double",
  char: "char",
  ptr: "void *",
  void: "void",
};

let backendCount = 0;

interface StructRegistration {
  readonly signature: string;
  readonly type: KoffiType;
}

export class KoffiBackend implements FfiBackend {
  private readonly structs = new Map<string, StructRegistration>();
  private readonly namespace = `xzb${++backendCount}`;

  constructor(private readonly koffi: KoffiModule) {}

  dlopen(path: string, symbols: Readonly<Record<string, SymbolDefinition>>): FfiLibrary {
    const library = this.koffi.load(path);
    const bound: Record<string, unknown> = {};
    for (const [name, definition] of Object.entries(symbols)) {
      const returns = this.toKoffiType(definition.returns);
      const args = definition.args.map((type) => this.toKoffiType(type));
      const fn = library.func(name, returns, args);
      bound[name] = this.wrapPointerReturn(definition.returns, fn);
    }
    return { symbols: bound, close: () => library.close?.() };
  }

  /**
   * A function returning an `XzStr`/`XzBytes` by value hands back a raw `void*`
   * field, which koffi exposes as an opaque pointer, not a byte view. Decode it
   * here with the sibling `len` so the generated binding's `decodeStr`/
   * `decodeBytes` sees bytes; keep the opaque pointer as `address` so a
   * `transfer` return can hand the original allocation to the release symbol
   * instead of freeing the decoded copy.
   */
  private wrapPointerReturn(type: FfiType, fn: KoffiFunction): KoffiFunction {
    if (!isPointerStruct(type)) {
      return fn;
    }
    return (...args) => {
      const value = fn(...args) as { readonly ptr: unknown; readonly len: number };
      const len = Number(value.len);
      const bytes = len === 0 ? new Uint8Array(0) : this.koffi.decode(value.ptr, "uint8_t", len);
      return { ptr: bytes, len, address: value.ptr };
    };
  }

  private toKoffiType(type: FfiType): KoffiFieldType {
    if (typeof type === "string") {
      return KOFFI_SCALAR[type];
    }
    return this.registerStruct(type);
  }

  private registerStruct(type: FfiStruct): KoffiType {
    const signature = structSignature(type);
    const existing = this.structs.get(type.name);
    if (existing !== undefined) {
      if (existing.signature !== signature) {
        throw new BridgeRuntimeError(
          `koffi already registered '@cstruct ${type.name}' with a different layout in this KoffiBackend; the same name must map to one layout per backend`,
        );
      }
      return existing.type;
    }
    const fields: Record<string, KoffiFieldType> = {};
    for (const field of type.fields) {
      fields[field.name] = this.toKoffiType(field.type);
    }
    const registered = this.koffi.struct(`${type.name}__${this.namespace}`, fields);
    this.structs.set(type.name, { signature, type: registered });
    return registered;
  }
}

/**
 * `koffi.struct` registers into a process-global, name-keyed table. The backend
 * prefixes each registration with a per-instance namespace so a second
 * `KoffiBackend` in the same process cannot collide with the first (or with any
 * other koffi consumer). The neutral `@cstruct` name stays the cache key; within
 * one backend it may carry only one layout, and a conflicting layout is a hard
 * error instead of silently reusing the first registration.
 */
function structSignature(type: FfiStruct): string {
  return `${type.name}{${type.fields
    .map((field) => `${field.name}:${ffiTypeSignature(field.type)}`)
    .join(",")}}`;
}

function ffiTypeSignature(type: FfiType): string {
  return typeof type === "string" ? type : structSignature(type);
}

function isPointerStruct(type: FfiType): boolean {
  return (
    typeof type !== "string" && (type.name === "XzStr" || type.name === "XzBytes")
  );
}

export async function loadKoffiBackend(): Promise<KoffiBackend> {
  let koffi: KoffiModule;
  try {
    const imported = (await import("koffi")) as unknown as KoffiModule & {
      readonly default?: KoffiModule;
    };
    koffi = imported.default ?? imported;
  } catch (cause) {
    throw new BridgeRuntimeError(
      "the Node loader requires the 'koffi' package; install koffi to load shared libraries on Node",
      { cause },
    );
  }
  return new KoffiBackend(koffi);
}

export async function loadNodeLibrary(
  manifest: LibraryManifest,
  options: Omit<LoadOptions, "backend">,
): Promise<LoadedLibrary> {
  const backend = await loadKoffiBackend();
  return loadLibrary(manifest, { ...options, backend });
}