import type { LibraryManifest } from "../ffi/manifest.js";
import { loadBunBackend } from "./bun.js";
import type { LoadOptions, LoadedLibrary } from "./load.js";
import { loadLibrary } from "./load.js";
import { loadKoffiBackend } from "./node.js";

export type RuntimePlatform = "bun" | "node";

export interface PlatformGlobals {
  readonly Bun?: unknown;
}

export function detectPlatform(
  globals: PlatformGlobals = globalThis as PlatformGlobals,
): RuntimePlatform {
  return globals.Bun === undefined ? "node" : "bun";
}

export async function loadPlatformLibrary(
  manifest: LibraryManifest,
  options: Omit<LoadOptions, "backend">,
): Promise<LoadedLibrary> {
  const backend =
    detectPlatform() === "bun" ? await loadBunBackend() : await loadKoffiBackend();
  return loadLibrary(manifest, { ...options, backend });
}