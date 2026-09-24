import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import {
  KoffiBackend,
  XzContractError,
  generateBinding,
  manifestFromInterface,
  parseInterface,
  type KoffiModule,
} from "../src/index.js";

const BRIDGE_ENTRY = new URL("../src/index.ts", import.meta.url).href;

// A real foreign C library exposing the XzStr layout: dup_str allocates and
// returns ownership to the caller, free_str releases it, and live_count reports
// the outstanding allocations so the test can prove the binding released it.
const FIXTURE_C = `
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <stddef.h>

typedef struct { const char* ptr; size_t len; } XzStr;

static int64_t live = 0;

XzStr dup_str(XzStr s) {
    char* buf = (char*)malloc(s.len + 1);
    memcpy(buf, s.ptr, s.len);
    buf[s.len] = '\\0';
    XzStr r = { buf, s.len };
    live++;
    return r;
}

void free_str(void* p) {
    if (p != 0) {
        free(p);
        live--;
    }
}

XzStr borrowed(void) {
    XzStr r = { "borrowed", 8 };
    return r;
}

int64_t live_count(void) { return live; }

int64_t add_i64(int64_t a, int64_t b) { return a + b; }
uint64_t echo_u64(uint64_t v) { return v; }
int64_t small_i64(void) { return 7; }
`;

const FIXTURE_INTERFACE =
  "@interface foreign\n" +
  "extern func free_str(ptr: Ptr) -> Unit\n" +
  "extern func dup_str(s: Str) -> transfer Str release free_str\n" +
  "extern func borrowed() -> Str\n" +
  "extern func live_count() -> Int\n";

const INT_INTERFACE =
  "@interface foreign\n" +
  "extern func add_i64(a: Int, b: Int) -> Int\n" +
  "extern func echo_u64(v: usize) -> usize\n" +
  "extern func small_i64() -> Int\n";

const CONTRACT_INTERFACE =
  "@interface foreign\n" +
  "@error InvalidAmount = 1\n" +
  "extern func parse_amount(text: Str, mut out: Float) -> Int contract ok 0\n";

const CONTRACT_FIXTURE_C = `
#include <stdint.h>
#include <stddef.h>

typedef struct { const char* ptr; size_t len; } XzStr;

int64_t parse_amount(XzStr s, double* out) {
    if (s.len == 0) {
        return 1;
    }
    *out = (double)s.len * 1.5;
    return 0;
}
`;

test("koffi smoke: a transfer return decodes and releases through a real .so", async (t) => {
  let koffi: KoffiModule;
  try {
    const imported = (await import("koffi")) as unknown as KoffiModule & {
      readonly default?: KoffiModule;
    };
    koffi = imported.default ?? imported;
  } catch {
    t.skip("koffi is not installed");
    return;
  }
  try {
    execFileSync("cc", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("no C compiler available");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "next-xz-koffi-"));
  try {
    const cFile = join(dir, "fixture.c");
    const soFile = join(dir, "libfixture.so");
    await writeFile(cFile, FIXTURE_C, "utf8");
    execFileSync("cc", ["-shared", "-fPIC", "-o", soFile, cFile], { stdio: "pipe" });

    const iface = parseInterface(FIXTURE_INTERFACE);
    const manifest = manifestFromInterface(iface, {
      name: "libfixture",
      path: soFile,
      xzVersion: "test",
    });
    const source = generateBinding(iface, {
      name: "libfixture",
      libraryPath: soFile,
      xzVersion: "test",
      importFrom: BRIDGE_ENTRY,
    });
    const moduleFile = join(dir, "libfixture.ts");
    await writeFile(moduleFile, source, "utf8");

    const module = (await import(pathToFileURL(moduleFile).href)) as {
      bind(backend: KoffiBackend): {
        dup_str(s: string): string;
        borrowed(): string;
        live_count(): bigint;
        close(): void;
      };
    };

    const binding = module.bind(new KoffiBackend(koffi));

    assert.equal(binding.dup_str("hello"), "hello");
    assert.equal(binding.live_count(), 0n, "the transferred buffer must be released");
    assert.equal(binding.borrowed(), "borrowed");
    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("koffi smoke: 64-bit ints cross as exact bigint, never a rounded number", async (t) => {
  let koffi: KoffiModule;
  try {
    const imported = (await import("koffi")) as unknown as KoffiModule & {
      readonly default?: KoffiModule;
    };
    koffi = imported.default ?? imported;
  } catch {
    t.skip("koffi is not installed");
    return;
  }
  try {
    execFileSync("cc", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("no C compiler available");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "next-xz-koffi-i64-"));
  try {
    const cFile = join(dir, "fixture.c");
    const soFile = join(dir, "libfixture.so");
    await writeFile(cFile, FIXTURE_C, "utf8");
    execFileSync("cc", ["-shared", "-fPIC", "-o", soFile, cFile], { stdio: "pipe" });

    const iface = parseInterface(INT_INTERFACE);
    const source = generateBinding(iface, {
      name: "libfixture",
      libraryPath: soFile,
      xzVersion: "test",
      importFrom: BRIDGE_ENTRY,
    });
    const moduleFile = join(dir, "libfixture.ts");
    await writeFile(moduleFile, source, "utf8");

    const module = (await import(pathToFileURL(moduleFile).href)) as {
      bind(backend: KoffiBackend): {
        add_i64(a: bigint, b: bigint): bigint;
        echo_u64(v: bigint): bigint;
        small_i64(): bigint;
        close(): void;
      };
    };

    const binding = module.bind(new KoffiBackend(koffi));

    assert.equal(binding.add_i64(2n, 3n), 5n, "a small 64-bit result stays exact as bigint");
    assert.equal(
      binding.add_i64(9_007_199_254_740_992n, 1n),
      9_007_199_254_740_993n,
      "an int64 above 2^53 must not be rounded",
    );
    assert.equal(
      binding.echo_u64(18_446_744_073_709_551_615n),
      18_446_744_073_709_551_615n,
      "the full uint64 range round-trips",
    );
    assert.equal(
      binding.small_i64(),
      7n,
      "a backend that reports a small 64-bit value as number is widened by asXzInt",
    );
    assert.equal(
      binding.add_i64(2 as unknown as bigint, 3 as unknown as bigint),
      5n,
      "asXzInt widens a safe-integer number parameter",
    );
    assert.throws(
      () => binding.add_i64(9_007_199_254_740_992 as unknown as bigint, 0n),
      /expected a 64-bit integer/,
      "an unsafe number parameter is a hard error, not a lossy cast",
    );
    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("koffi smoke: the generated loadPlatform entry dispatches to the real koffi loader", async (t) => {
  try {
    const imported = await import("koffi");
    void imported;
  } catch {
    t.skip("koffi is not installed");
    return;
  }
  try {
    execFileSync("cc", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("no C compiler available");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "next-xz-koffi-platform-"));
  try {
    const cFile = join(dir, "fixture.c");
    const soFile = join(dir, "libfixture.so");
    await writeFile(cFile, FIXTURE_C, "utf8");
    execFileSync("cc", ["-shared", "-fPIC", "-o", soFile, cFile], { stdio: "pipe" });

    const iface = parseInterface(INT_INTERFACE);
    const source = generateBinding(iface, {
      name: "libfixture",
      libraryPath: soFile,
      xzVersion: "test",
      importFrom: BRIDGE_ENTRY,
    });
    const moduleFile = join(dir, "libfixture.ts");
    await writeFile(moduleFile, source, "utf8");

    const module = (await import(pathToFileURL(moduleFile).href)) as {
      loadPlatform(platform?: string): Promise<{
        add_i64(a: bigint, b: bigint): bigint;
        close(): void;
      }>;
    };

    // No explicit platform: detectPlatform must select the Node/koffi path from
    // the ambient globals (no Bun, process.versions.node present).
    const binding = await module.loadPlatform();
    assert.equal(binding.add_i64(2n, 3n), 5n);
    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("koffi smoke: a contracted wrapper reads the out value and raises the status error", async (t) => {
  let koffi: KoffiModule;
  try {
    const imported = (await import("koffi")) as unknown as KoffiModule & {
      readonly default?: KoffiModule;
    };
    koffi = imported.default ?? imported;
  } catch {
    t.skip("koffi is not installed");
    return;
  }
  try {
    execFileSync("cc", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("no C compiler available");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "next-xz-koffi-contract-"));
  try {
    const cFile = join(dir, "fixture.c");
    const soFile = join(dir, "libfixture.so");
    await writeFile(cFile, CONTRACT_FIXTURE_C, "utf8");
    execFileSync("cc", ["-shared", "-fPIC", "-o", soFile, cFile], { stdio: "pipe" });

    const iface = parseInterface(CONTRACT_INTERFACE);
    const source = generateBinding(iface, {
      name: "libfixture",
      libraryPath: soFile,
      xzVersion: "test",
      importFrom: BRIDGE_ENTRY,
    });
    const moduleFile = join(dir, "libfixture.ts");
    await writeFile(moduleFile, source, "utf8");

    const module = (await import(pathToFileURL(moduleFile).href)) as {
      bind(backend: KoffiBackend): {
        parse_amount(text: string): number;
        close(): void;
      };
    };

    const binding = module.bind(new KoffiBackend(koffi));

    assert.equal(binding.parse_amount("abcd"), 6, "the ok path returns the out value");
    assert.throws(
      () => binding.parse_amount(""),
      (error: unknown) =>
        error instanceof Error &&
        error.name === "XzContractError" &&
        (error as XzContractError).code === 1 &&
        (error as XzContractError).errorName === "InvalidAmount",
      "a non-ok status raises the declared error",
    );
    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
