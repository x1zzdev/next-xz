import { BridgeRuntimeError } from "../errors.js";
import type { LibraryManifest } from "../ffi/manifest.js";
import { loadBunBackend } from "./bun.js";
import type { LoadOptions, LoadedLibrary } from "./load.js";
import { loadLibrary } from "./load.js";
import { loadKoffiBackend } from "./node.js";

export type RuntimePlatform = "bun" | "node" | "edge";

export interface PlatformGlobals {
  readonly Bun?: unknown;
  readonly process?: { readonly versions?: { readonly node?: string } };
  readonly WebAssembly?: unknown;
}

export function detectPlatform(
  globals: PlatformGlobals = globalThis as PlatformGlobals,
): RuntimePlatform {
  if (globals.Bun !== undefined) {
    return "bun";
  }
  if (globals.process?.versions?.node === undefined && globals.WebAssembly !== undefined) {
    return "edge";
  }
  return "node";
}

export async function loadPlatformLibrary(
  manifest: LibraryManifest,
  options: Omit<LoadOptions, "backend">,
): Promise<LoadedLibrary> {
  const platform = detectPlatform();
  if (platform === "edge") {
    throw new BridgeRuntimeError(
      "the Edge runtime has no native FFI; compile a WebAssembly module and bind it with loadWasmLibrary",
    );
  }
  const backend = platform === "bun" ? await loadBunBackend() : await loadKoffiBackend();
  return loadLibrary(manifest, { ...options, backend });
}