import { BridgeRuntimeError } from "../errors.js";
import type { LibraryManifest, SymbolDefinition } from "../ffi/manifest.js";
import type { FfiScalar, FfiType } from "../ffi/types.js";
import type { FfiBackend, FfiLibrary } from "./ffi-backend.js";
import { loadLibrary, type LoadOptions, type LoadedLibrary } from "./load.js";

export interface KoffiSignature {
  readonly ret: string;
  readonly args: readonly string[];
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
  constructor(private readonly koffi: KoffiModule) {}

  dlopen(path: string, symbols: Readonly<Record<string, SymbolDefinition>>): FfiLibrary {
    const signatures: Record<string, KoffiSignature> = {};
    for (const [name, definition] of Object.entries(symbols)) {
      signatures[name] = {
        ret: toKoffiType(definition.returns, name, "return"),
        args: definition.args.map((type, index) => toKoffiType(type, name, `arg ${index}`)),
      };
    }

    const library = this.koffi.load(path);
    const bound: Record<string, unknown> = {};
    for (const [name, signature] of Object.entries(signatures)) {
      bound[name] = library.func(signature);
    }
    return { symbols: bound, close: () => library.close?.() };
  }
}

function toKoffiType(type: FfiType, symbol: string, position: string): string {
  if (typeof type !== "string") {
    throw new BridgeRuntimeError(
      `koffi cannot bind struct '${type.name}' by value for '${symbol}' (${position}); struct marshalling is not implemented yet`,
    );
  }
  return KOFFI_SCALAR[type];
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