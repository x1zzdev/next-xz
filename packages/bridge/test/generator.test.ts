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

test("emits encode/decode calls for Str and Bytes parameters and returns", () => {
  const iface = parseInterface(
    "extern func parse(text: Str) -> Int\nextern func name(id: Int) -> Str\nextern func raw() -> Bytes\n",
  );
  const source = generateBinding(iface, options);
  assert.match(source, /import \{[^}]*encodeStr[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /import \{[^}]*type XzPointerValue[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /return symbols\["parse"\]!\(encodeStr\(text\)\) as number;/);
  assert.match(source, /return decodeStr\(symbols\["name"\]!\(id\) as XzPointerValue\);/);
  assert.match(source, /return decodeBytes\(symbols\["raw"\]!\(\) as XzPointerValue\);/);
});

test("rejects a mutable parameter until the contract wrapper is emitted", () => {
  const iface = parseInterface("extern func parse(mut out: Float) -> Int\n");
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("mutable parameter"),
  );
});

test("emits ownership handoff that retains the backing buffer for transfer", () => {
  const iface = parseInterface(
    "extern func write(transfer frame: Bytes) -> Int\nextern func send(transfer text: Str)\n",
  );
  const source = generateBinding(iface, options);
  assert.match(source, /const retained: Uint8Array\[\] = \[\];/);
  assert.match(source, /const framePointer = encodeBytes\(frame\);/);
  assert.match(source, /retained\.push\(framePointer\.ptr\);/);
  assert.match(source, /return symbols\["write"\]!\(framePointer\) as number;/);
  assert.match(source, /const textPointer = encodeStr\(text\);/);
  assert.match(source, /retained\.push\(textPointer\.ptr\);/);
  assert.match(source, /retained\.length = 0;/);
});

test("rejects a transfer parameter that is not a buffer", () => {
  const iface = parseInterface("extern func take(transfer amount: Int) -> Int\n");
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("transfer"),
  );
});

test("rejects a Str field inside a @cstruct record", () => {
  const iface = parseInterface("@cstruct record Name {\n    text: Str\n}\nextern func id(n: Name) -> Name\n");
  assert.throws(() => generateBinding(iface, options), BridgeDefinitionError);
});

test("casts each symbol call to the declared TypeScript return type", () => {
  const iface = parseInterface(
    "@cstruct record Vec2 {\n    x: Int\n    y: Int\n}\nextern func add(a: Int, b: Int) -> Int\nextern func sum(v: Vec2) -> Int\nextern func run() -> Unit\n",
  );
  const source = generateBinding(iface, options);
  assert.match(source, /return symbols\["add"\]!\(a, b\) as number;/);
  assert.match(source, /return symbols\["sum"\]!\(v\) as number;/);
  assert.match(source, /symbols\["run"\]!\(\);/);
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

test("generated module marshals Str/Bytes and holds transferred buffers until close", async () => {
  const iface = parseInterface(
    "extern func hash(data: Bytes) -> Int\nextern func write(transfer frame: Bytes) -> Unit\nextern func greet(name: Str) -> Str\n",
  );
  const source = generateBinding(iface, { ...options, importFrom: bridgeEntry });

  const dir = await mkdtemp(join(tmpdir(), "next-xz-gen-"));
  try {
    const file = join(dir, "liborder.ts");
    await writeFile(file, source, "utf8");

    const module = (await import(pathToFileURL(file).href)) as {
      bind(backend: FfiBackend): {
        hash(data: Uint8Array): number;
        write(frame: Uint8Array): void;
        greet(name: string): string;
        close(): void;
      };
    };

    const seen: Array<{ ptr: Uint8Array; len: number }> = [];
    const backend: FfiBackend = {
      dlopen: () => ({
        symbols: {
          hash: (value: { ptr: Uint8Array; len: number }) => {
            seen.push(value);
            return value.len;
          },
          write: (value: { ptr: Uint8Array; len: number }) => {
            seen.push(value);
            return undefined;
          },
          greet: (value: { ptr: Uint8Array; len: number }) => {
            seen.push(value);
            return { ptr: new TextEncoder().encode("hello"), len: 5 };
          },
        },
        close: () => {},
      }),
    };

    const binding = module.bind(backend);
    const borrowed = new Uint8Array([1, 2, 3]);
    assert.equal(binding.hash(borrowed), 3);
    assert.equal(seen[0]?.ptr, borrowed);

    const transferred = new Uint8Array([4, 5]);
    binding.write(transferred);
    assert.equal(seen[1]?.ptr, transferred);

    assert.equal(binding.greet("héllo"), "hello");
    assert.deepEqual([...seen[2]!.ptr], [...new TextEncoder().encode("héllo")]);

    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});