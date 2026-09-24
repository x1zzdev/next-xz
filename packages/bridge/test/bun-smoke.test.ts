import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

import { generateBinding, parseInterface } from "../src/index.js";

const BRIDGE_ENTRY = new URL("../src/index.ts", import.meta.url).href;
const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("../../..", import.meta.url));

// Scalars only: bun:ffi has no by-value struct FFIType, so this fixture stays
// on the ABI both backends share. It exercises the same 64-bit contract as the
// koffi smoke test but through the Bun runtime's `loadPlatform` dispatch.
const FIXTURE_C = `
#include <stdint.h>

int64_t add_i64(int64_t a, int64_t b) { return a + b; }
uint64_t echo_u64(uint64_t v) { return v; }
int64_t small_i64(void) { return 7; }
`;

const INT_INTERFACE =
  "@interface foreign\n" +
  "extern func add_i64(a: Int, b: Int) -> Int\n" +
  "extern func echo_u64(v: usize) -> usize\n" +
  "extern func small_i64() -> Int\n";

// The child runs under Bun, calls the generated `loadPlatform()` with no
// override, and proves that ambient detection picked the bun:ffi backend.
const RUNNER = `
import assert from "node:assert/strict";

const mod = await import(process.env.XZ_BUN_MODULE);
const binding = await mod.loadPlatform();

assert.equal(binding.add_i64(2n, 3n), 5n);
assert.equal(
  binding.add_i64(9007199254740992n, 1n),
  9007199254740993n,
  "an int64 above 2^53 must not be rounded",
);
assert.equal(
  binding.echo_u64(18446744073709551615n),
  18446744073709551615n,
  "the full uint64 range round-trips through bun:ffi",
);
assert.equal(binding.small_i64(), 7n);
binding.close();

console.log("BUN_E2E_OK");
`;

function resolveBun(): string | undefined {
  const explicit = process.env.BUN_BIN;
  if (explicit !== undefined && explicit !== "") {
    return explicit;
  }
  for (const candidate of [
    join(PACKAGE_ROOT, "node_modules", ".bin", "bun"),
    join(REPO_ROOT, "node_modules", ".bin", "bun"),
  ]) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    execFileSync("bun", ["--version"], { stdio: "ignore" });
    return "bun";
  } catch {
    return undefined;
  }
}

test("bun smoke: the generated loadPlatform entry dispatches to the real bun:ffi loader", async (t) => {
  const bun = resolveBun();
  if (bun === undefined) {
    t.skip("the Bun runtime is not installed");
    return;
  }
  try {
    execFileSync("cc", ["--version"], { stdio: "ignore" });
  } catch {
    t.skip("no C compiler available");
    return;
  }

  const dir = await mkdtemp(join(tmpdir(), "next-xz-bun-"));
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
    const runnerFile = join(dir, "runner.ts");
    await writeFile(moduleFile, source, "utf8");
    await writeFile(runnerFile, RUNNER, "utf8");

    const output = execFileSync(bun, [runnerFile], {
      env: { ...process.env, XZ_BUN_MODULE: pathToFileURL(moduleFile).href },
    });
    assert.match(output.toString(), /BUN_E2E_OK/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});