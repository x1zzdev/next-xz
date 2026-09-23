import { BridgeRuntimeError } from "../errors.js";
import type { LibraryManifest, SymbolDefinition } from "../ffi/manifest.js";
import type { FfiScalar, FfiType } from "../ffi/types.js";
import type { FfiBackend, FfiLibrary } from "./ffi-backend.js";
import { loadLibrary, type LoadOptions, type LoadedLibrary } from "./load.js";

export interface WasmModule {}

export interface WasmInstance {
  readonly exports: Readonly<Record<string, unknown>>;
}

interface WasmRuntime {
  readonly Module: { new (bytes: Uint8Array): WasmModule };
  readonly Instance: {
    new (module: WasmModule, imports?: Record<string, unknown>): WasmInstance;
  };
}

function runtime(): WasmRuntime {
  const wasm = (globalThis as { WebAssembly?: WasmRuntime }).WebAssembly;
  if (wasm === undefined) {
    throw new BridgeRuntimeError("WebAssembly is not available in this runtime");
  }
  return wasm;
}

export function compileWasm(bytes: Uint8Array): WasmModule {
  return new (runtime().Module)(bytes);
}

export function instantiateWasm(
  module: WasmModule,
  imports?: Record<string, unknown>,
): WasmInstance {
  return imports === undefined
    ? new (runtime().Instance)(module)
    : new (runtime().Instance)(module, imports);
}

const WASM_SCALAR: Readonly<Record<FfiScalar, boolean>> = {
  bool: true,
  int64: true,
  uint64: true,
  double: true,
  char: true,
  ptr: false,
  void: true,
};

type WasmFunction = (...args: unknown[]) => unknown;

export class WasmBackend implements FfiBackend {
  constructor(private readonly instance: WasmInstance) {}

  dlopen(_path: string, symbols: Readonly<Record<string, SymbolDefinition>>): FfiLibrary {
    const bound: Record<string, unknown> = {};
    for (const [name, definition] of Object.entries(symbols)) {
      assertSupported(name, definition);
      const fn = this.instance.exports[name];
      if (typeof fn !== "function") {
        continue;
      }
      bound[name] = wrapFunction(definition, fn as WasmFunction);
    }
    return { symbols: bound, close: () => {} };
  }
}

function assertSupported(name: string, definition: SymbolDefinition): void {
  for (const type of [...definition.args, definition.returns]) {
    if (typeof type !== "string" || !WASM_SCALAR[type]) {
      const shape = typeof type === "string" ? type : `struct '${type.name}'`;
      throw new BridgeRuntimeError(
        `the WebAssembly backend cannot marshal '${name}' with a ${shape} signature; only scalar signatures are supported on Edge`,
      );
    }
  }
}

function wrapFunction(definition: SymbolDefinition, fn: WasmFunction): WasmFunction {
  const adapters = definition.args.map(argumentAdapter);
  const adaptReturn = returnAdapter(definition.returns);
  return (...args: unknown[]) => {
    const adapted = args.map((value, index) => (adapters[index] ?? identity)(value));
    return adaptReturn(fn(...adapted));
  };
}

function identity(value: unknown): unknown {
  return value;
}

function argumentAdapter(type: FfiType): (value: unknown) => unknown {
  if (type === "bool") {
    return (value) => {
      if (typeof value !== "boolean") {
        throw new BridgeRuntimeError(`the WebAssembly backend requires a boolean, got ${typeof value}`);
      }
      return value ? 1 : 0;
    };
  }
  if (type === "char") {
    return (value) => {
      if (typeof value !== "string" || [...value].length !== 1) {
        throw new BridgeRuntimeError("the WebAssembly backend requires a single-character string");
      }
      return value.codePointAt(0)!;
    };
  }
  return identity;
}

function returnAdapter(type: FfiType): (value: unknown) => unknown {
  if (type === "bool") {
    return (value) => Number(value) !== 0;
  }
  if (type === "char") {
    return (value) => String.fromCharCode(Number(value));
  }
  if (type === "void") {
    return () => undefined;
  }
  return identity;
}

export interface WasmLoadOptions {
  readonly expectedXzVersion: string;
  readonly requiredSymbols?: readonly string[];
  readonly module: WasmModule;
}

export function loadWasmLibrary(
  manifest: LibraryManifest,
  options: WasmLoadOptions,
): LoadedLibrary {
  const backend = new WasmBackend(instantiateWasm(options.module));
  const base: Omit<LoadOptions, "backend"> = {
    expectedXzVersion: options.expectedXzVersion,
  };
  return loadLibrary(manifest, {
    ...base,
    ...(options.requiredSymbols === undefined ? {} : { requiredSymbols: options.requiredSymbols }),
    backend,
  });
}