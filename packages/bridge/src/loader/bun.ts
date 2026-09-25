import { BridgeRuntimeError } from "../errors.js";
import type { LibraryManifest, SymbolDefinition } from "../ffi/manifest.js";
import type { FfiScalar, FfiType } from "../ffi/types.js";
import type { FfiBackend, FfiLibrary } from "./ffi-backend.js";
import { loadLibrary, type LoadOptions, type LoadedLibrary } from "./load.js";

export interface BunFfiFunction {
  readonly args: readonly number[];
  readonly returns: number;
}

export interface BunFfiLibrary {
  readonly symbols: Record<string, unknown>;
  close(): void;
}

export interface BunFfiModule {
  readonly FFIType: Readonly<Record<string, number>>;
  dlopen(path: string, symbols: Record<string, BunFfiFunction>): BunFfiLibrary;
}

const BUN_FFI_KEY: Readonly<Record<FfiScalar, string>> = {
  bool: "bool",
  int64: "int64_t",
  uint64: "uint64_t",
  double: "double",
  char: "char",
  ptr: "ptr",
  void: "void",
};

/**
 * The `bun:ffi` `FFIType` keys the loader depends on. The bridge keeps its own
 * minimal ambient declaration (`bun-ffi.d.ts`) instead of adopting the global
 * `bun-types` package, so this list is the contract that the Bun smoke test
 * pins against the real runtime's `FFIType` table. Any missing key would
 * otherwise surface only at load time.
 */
export const BUN_FFI_TYPE_KEYS: readonly string[] = Object.freeze(Object.values(BUN_FFI_KEY));

export class BunFfiBackend implements FfiBackend {
  constructor(private readonly ffi: BunFfiModule) {}

  dlopen(path: string, symbols: Readonly<Record<string, SymbolDefinition>>): FfiLibrary {
    const definitions: Record<string, BunFfiFunction> = {};
    for (const [name, definition] of Object.entries(symbols)) {
      definitions[name] = {
        args: definition.args.map((type) => this.toFfiType(type)),
        returns: this.toFfiType(definition.returns),
      };
    }
    const library = this.ffi.dlopen(path, definitions);
    return { symbols: library.symbols, close: () => library.close() };
  }

  /**
   * `bun:ffi`'s FFIType table covers scalars and raw pointers only; it has no
   * by-value struct type, so `Str`, `Bytes`, or a `@cstruct` cannot be
   * declared. The loader refuses rather than degrade the signature and names
   * the Node koffi backend as the supported path (§3.1).
   */
  private toFfiType(type: FfiType): number {
    if (typeof type !== "string") {
      throw new BridgeRuntimeError(
        `bun:ffi has no by-value struct FFIType for '${type.name}'; use the Node koffi loader for Str/Bytes/@cstruct symbols`,
      );
    }
    const value = this.ffi.FFIType[BUN_FFI_KEY[type]];
    if (value === undefined) {
      throw new BridgeRuntimeError(`bun:ffi exposes no FFIType for '${type}'`);
    }
    return value;
  }
}

export async function loadBunBackend(): Promise<BunFfiBackend> {
  let ffi: BunFfiModule;
  try {
    ffi = (await import("bun:ffi")) as unknown as BunFfiModule;
  } catch (cause) {
    throw new BridgeRuntimeError(
      "the Bun loader requires the Bun runtime; 'bun:ffi' is unavailable",
      { cause },
    );
  }
  return new BunFfiBackend(ffi);
}

export async function loadBunLibrary(
  manifest: LibraryManifest,
  options: Omit<LoadOptions, "backend">,
): Promise<LoadedLibrary> {
  const backend = await loadBunBackend();
  return loadLibrary(manifest, { ...options, backend });
}
