import type { SymbolDefinition } from "../ffi/manifest.js";

export interface FfiLibrary {
  readonly symbols: Readonly<Record<string, unknown>>;
  close(): void;
}

export interface FfiBackend {
  dlopen(path: string, symbols: Readonly<Record<string, SymbolDefinition>>): FfiLibrary;
}
