import { BridgeRuntimeError } from "../errors.js";
import type { LibraryManifest, SymbolDefinition } from "../ffi/manifest.js";
import type { FfiScalar, FfiStruct, FfiType } from "../ffi/types.js";
import type { FfiBackend, FfiLibrary } from "./ffi-backend.js";
import { loadLibrary, type LoadOptions, type LoadedLibrary } from "./load.js";

export type KoffiType = object;

export type KoffiFieldType = string | KoffiType;

export interface KoffiSignature {
  readonly ret: KoffiFieldType;
  readonly args: readonly KoffiFieldType[];
}

export interface KoffiFunction {
  (...args: unknown[]): unknown;
}

export interface KoffiLibrary {
  func(signature: KoffiSignature): KoffiFunction;
  close?(): void;
}

export interface KoffiModule {
  load(path: string): KoffiLibrary;
  struct(name: string, fields: Readonly<Record<string, KoffiFieldType>>): KoffiType;
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

export class KoffiBackend implements FfiBackend {
  private readonly structs = new Map<string, KoffiType>();

  constructor(private readonly koffi: KoffiModule) {}

  dlopen(path: string, symbols: Readonly<Record<string, SymbolDefinition>>): FfiLibrary {
    const signatures: Record<string, KoffiSignature> = {};
    for (const [name, definition] of Object.entries(symbols)) {
      signatures[name] = {
        ret: this.toKoffiType(definition.returns),
        args: definition.args.map((type) => this.toKoffiType(type)),
      };
    }

    const library = this.koffi.load(path);
    const bound: Record<string, unknown> = {};
    for (const [name, signature] of Object.entries(signatures)) {
      bound[name] = library.func(signature);
    }
    return { symbols: bound, close: () => library.close?.() };
  }

  private toKoffiType(type: FfiType): KoffiFieldType {
    if (typeof type === "string") {
      return KOFFI_SCALAR[type];
    }
    return this.registerStruct(type);
  }

  private registerStruct(type: FfiStruct): KoffiType {
    const existing = this.structs.get(type.name);
    if (existing !== undefined) {
      return existing;
    }
    const fields: Record<string, KoffiFieldType> = {};
    for (const field of type.fields) {
      fields[field.name] = this.toKoffiType(field.type);
    }
    const registered = this.koffi.struct(type.name, fields);
    this.structs.set(type.name, registered);
    return registered;
  }
}

export async function loadKoffiBackend(): Promise<KoffiBackend> {
  let koffi: KoffiModule;
  try {
    koffi = (await import("koffi")) as unknown as KoffiModule;
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