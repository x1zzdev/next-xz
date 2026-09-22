import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

import {
  BridgeDefinitionError,
  generateBinding,
  parseInterface,
  type FfiBackend,
} from "../src/index.js";

const bridgeEntry = new URL("../src/index.ts", import.meta.url).href;

const options = {
  name: "liborder",
  libraryPath: ".next-xz/liborder.so",
  xzVersion: "0.1.0",
};

test("emits a TypeScript interface per @cstruct with declaration order", () => {
  const iface = parseInterface(
    "@cstruct record Point {\n    x: Int\n    y: Int\n}\n@cstruct record Line {\n    a: Point\n    b: Point\n}\n",
  );
  const source = generateBinding(iface, options);
  assert.match(source, /export interface Point \{\n  x: number;\n  y: number;\n\}/);
  assert.match(source, /export interface Line \{\n  a: Point;\n  b: Point;\n\}/);
});

test("emits a manifest with backend-neutral FFI types", () => {
  const iface = parseInterface("extern func add(a: Int, b: Int) -> Int\nextern func run() -> Unit\n");
  const source = generateBinding(iface, options);
  assert.match(source, /name: "liborder"/);
  assert.match(source, /path: "\.next-xz\/liborder\.so"/);
  assert.match(source, /"add": \{ args: \["int64", "int64"\], returns: "int64" \}/);
  assert.match(source, /"run": \{ args: \[\], returns: "void" \}/);
});

test("rejects Str/Bytes until the binding emits encode/decode", () => {
  const iface = parseInterface("extern func parse(text: Str) -> Int\n");
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("encode/decode"),
  );
});

test("rejects a mutable parameter until the contract wrapper is emitted", () => {
  const iface = parseInterface("extern func parse(mut out: Float) -> Int\n");
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("mutable parameter"),
  );
});

test("rejects a Str field inside a @cstruct record", () => {
  const iface = parseInterface("@cstruct record Name {\n    text: Str\n}\nextern func id(n: Name) -> Name\n");
  assert.throws(() => generateBinding(iface, options), BridgeDefinitionError);
});

test("generated module loads, calls a symbol, and closes through an injected backend", async () => {
  const iface = parseInterface("extern func add(a: Int, b: Int) -> Int\nextern func noop()\n");
  const source = generateBinding(iface, { ...options, importFrom: bridgeEntry });

  const dir = await mkdtemp(join(tmpdir(), "next-xz-gen-"));
  try {
    const file = join(dir, "liborder.ts");
    await writeFile(file, source, "utf8");

    const module = (await import(pathToFileURL(file).href)) as {
      bind(backend: FfiBackend): {
        add(a: number, b: number): number;
        noop(): void;
        close(): void;
      };
    };

    let closed = false;
    const calls: unknown[][] = [];
    const backend: FfiBackend = {
      dlopen: () => ({
        symbols: {
          add: (a: unknown, b: unknown) => {
            calls.push([a, b]);
            return (a as number) + (b as number);
          },
          noop: () => {
            calls.push([]);
            return undefined;
          },
        },
        close: () => {
          closed = true;
        },
      }),
    };

    const binding = module.bind(backend);
    assert.equal(binding.add(2, 3), 5);
    binding.noop();
    assert.deepEqual(calls, [[2, 3], []]);
    binding.close();
    assert.equal(closed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});