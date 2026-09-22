import { BridgeSymbolError, BridgeVersionError } from "../errors.js";
import type { LibraryManifest } from "../ffi/manifest.js";
import type { FfiBackend } from "./ffi-backend.js";

export interface LoadOptions {
  readonly expectedXzVersion: string;
  readonly requiredSymbols?: readonly string[];
  readonly backend: FfiBackend;
}

export interface LoadedLibrary {
  readonly manifest: LibraryManifest;
  readonly symbols: Readonly<Record<string, unknown>>;
  close(): void;
}

export function loadLibrary(manifest: LibraryManifest, options: LoadOptions): LoadedLibrary {
  if (manifest.xzVersion !== options.expectedXzVersion) {
    throw new BridgeVersionError(manifest.path, options.expectedXzVersion, manifest.xzVersion);
  }

  for (const name of options.requiredSymbols ?? []) {
    if (!Object.prototype.hasOwnProperty.call(manifest.symbols, name)) {
      throw new BridgeSymbolError(manifest.path, name, "not declared in the library manifest");
    }
  }

  const library = options.backend.dlopen(manifest.path, manifest.symbols);
  for (const name of Object.keys(manifest.symbols)) {
    if (typeof library.symbols[name] !== "function") {
      library.close();
      throw new BridgeSymbolError(manifest.path, name, "not found in the loaded shared object");
    }
  }

  return { manifest, symbols: library.symbols, close: () => library.close() };
}
