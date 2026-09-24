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
const EXPORT = "@interface export\n";
const FOREIGN = "@interface foreign\n";

const options = {
  name: "liborder",
  libraryPath: ".next-xz/liborder.so",
  xzVersion: "0.1.0",
};

test("emits a TypeScript interface per @cstruct with declaration order", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Point {\n    x: Int\n    y: Int\n}\n@cstruct record Line {\n    a: Point\n    b: Point\n}\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(source, /export interface Point \{\n  x: bigint;\n  y: bigint;\n\}/);
  assert.match(source, /export interface Line \{\n  a: Point;\n  b: Point;\n\}/);
});

test("emits a manifest with backend-neutral FFI types", () => {
  const iface = parseInterface(
    `${EXPORT}extern func add(a: Int, b: Int) -> Int\nextern func run() -> Unit\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(source, /name: "liborder"/);
  assert.match(source, /path: "\.next-xz\/liborder\.so"/);
  assert.match(source, /"add": \{ args: \["int64", "int64"\], returns: "int64" \}/);
  assert.match(source, /"run": \{ args: \[\], returns: "void" \}/);
});

test("emits a loadPlatform entry that selects the backend from the runtime", () => {
  const iface = parseInterface(`${EXPORT}extern func add(a: Int, b: Int) -> Int\n`);
  const source = generateBinding(iface, options);
  assert.match(source, /import \{[^}]*loadPlatformLibrary[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /import \{[^}]*type LoadedLibrary[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /import \{[^}]*type RuntimePlatform[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /export async function loadPlatform\(platform\?: RuntimePlatform\): Promise<Binding> \{/);
  assert.match(
    source,
    /await loadPlatformLibrary\(manifest, \{ expectedXzVersion: manifest\.xzVersion, platform \}\)/,
  );
  assert.match(source, /function createBinding\(loaded: LoadedLibrary\): Binding \{/);
  assert.match(source, /return createBinding\(/);
});

test("emits encode/decode calls for Str and Bytes parameters and returns", () => {
  const iface = parseInterface(
    `${EXPORT}extern func parse(text: Str) -> Int\nextern func name(id: Int) -> Str\nextern func raw() -> Bytes\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(source, /import \{[^}]*encodeStr[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /import \{[^}]*type XzPointerValue[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /return asXzInt\(symbols\["parse"\]!\(encodeStr\(text\)\)\);/);
  assert.match(source, /return decodeStr\(symbols\["name"\]!\(asXzInt\(id\)\) as XzPointerValue\);/);
  assert.match(source, /return decodeBytes\(symbols\["raw"\]!\(\) as XzPointerValue\);/);
});

test("emits a contracted wrapper that acquires the out value on the ok path", () => {
  const iface = parseInterface(
    `${EXPORT}@error InvalidAmount = 1\n@error Overflow = 2\nextern func parse(text: Str, mut out: Float) -> Int contract ok 0\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(source, /import \{[^}]*asStatusCode, runContracted[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /parse\(text: string\): number;/);
  assert.match(source, /const out = new Float64Array\(1\);/);
  assert.match(
    source,
    /return runContracted\(\n        \{ library: manifest\.name, symbol: "parse", okCode: 0, errorNames: \{ 1: "InvalidAmount", 2: "Overflow" \} \},\n        \(\) => asStatusCode\(symbols\["parse"\]!\(encodeStr\(text\), out\)\),\n        \(\) => out\[0\]!,\n      \);/,
  );
});

test("emits an out-slot per scalar out-parameter type", () => {
  const iface = parseInterface(
    `${EXPORT}extern func b(mut out: Bool) -> Int contract ok 0\nextern func c(mut out: Char) -> Int contract ok 0\nextern func i(mut out: Int) -> Int contract ok 0\nextern func u(mut out: usize) -> Int contract ok 0\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(source, /const out = new Uint8Array\(1\);\n      return runContracted\([\s\S]*?\(\) => out\[0\] !== 0,/);
  assert.match(source, /String\.fromCharCode\(out\[0\]!\)/);
  assert.match(source, /const out = new BigInt64Array\(1\);/);
  assert.match(source, /const out = new BigUint64Array\(1\);/);
});

test("rejects a mutable parameter that is not part of a contract", () => {
  const iface = parseInterface(`${EXPORT}extern func parse(mut out: Float) -> Int\n`);
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("only as the out-parameter of a contracted wrapper"),
  );
});

test("rejects a contracted out-parameter with no generated out-slot", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Point { x: Float y: Float }\nextern func parse(mut out: Point) -> Int contract ok 0\n`,
  );
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("no generated out-slot"),
  );
});

test("rejects a transfer parameter the exported boundary cannot carry", () => {
  const iface = parseInterface(
    `${EXPORT}extern func write(transfer frame: Bytes) -> Int\nextern func send(transfer text: Str)\n`,
  );
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("C ABI ownership declaration"),
  );
});

test("emits a retained transfer parameter in a foreign interface", () => {
  const iface = parseInterface(`${FOREIGN}extern func write(transfer frame: Bytes) -> Int\n`);
  const source = generateBinding(iface, options);
  assert.match(source, /const retained: Uint8Array\[\] = \[\];/);
  assert.match(source, /const framePointer = encodeBytes\(frame\);/);
  assert.match(source, /retained\.push\(framePointer\.ptr\);/);
  assert.match(source, /return asXzInt\(symbols\["write"\]!\(framePointer\)\);/);
  assert.match(source, /retained\.length = 0;/);
});

test("rejects a transfer return without a release symbol", () => {
  const iface = parseInterface(`${FOREIGN}extern func read(path: Str) -> transfer Str\n`);
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("must declare its deallocator"),
  );
});

test("rejects a transfer return with no Str/Bytes release path", () => {
  const iface = parseInterface(
    `${FOREIGN}extern func free(ptr: Ptr) -> Unit\nextern func get() -> transfer Ptr release free\n`,
  );
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("only for top-level Str/Bytes"),
  );
});

test("emits a release call around a transfer return", () => {
  const iface = parseInterface(
    `${FOREIGN}extern func free(ptr: Ptr) -> Unit\nextern func strdup(s: Str) -> transfer Str release free\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(source, /const result = symbols\["strdup"\]!\(encodeStr\(s\)\) as XzPointerValue;/);
  assert.match(source, /try \{\n        return decodeStr\(result\);/);
  assert.match(source, /finally \{\n        symbols\["free"\]!\(result\.address \?\? result\.ptr\);/);
});

test("emits a transfer return's release symbol into the manifest", () => {
  const iface = parseInterface(
    `${FOREIGN}extern func free(ptr: Ptr) -> Unit\nextern func strdup(s: Str) -> transfer Str release free\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(source, /"strdup": \{.*release: "free" \}/);
  assert.match(source, /"free": \{ args: \["ptr"\], returns: "void" \}/);
});

test("rejects a Str field inside a @cstruct record", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Name {\n    text: Str\n}\nextern func id(n: Name) -> Name\n`,
  );
  assert.throws(() => generateBinding(iface, options), BridgeDefinitionError);
});

test("rejects a duplicate @cstruct declaration before it can be overwritten", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Vec2 { x: Int y: Int }\n@cstruct record Vec2 { a: Int }\nextern func f(v: Vec2) -> Int\n`,
  );
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("declared more than once"),
  );
});

test("rejects an extern function declared more than once", () => {
  const iface = parseInterface(`${EXPORT}extern func f() -> Int\nextern func f() -> Int\n`);
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("extern function is declared more than once"),
  );
});

test("reports interface validation problems before generator-specific rejections", () => {
  const iface = parseInterface(
    `${EXPORT}extern func f(mut out: Float) -> Int\nextern func f() -> Int\n`,
  );
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("extern function is declared more than once"),
  );
});

test("rejects a @cstruct name that shadows a built-in primitive", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Int { value: Float }\nextern func f(x: Int) -> Int\n`,
  );
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError &&
      error.message.includes("collides with the built-in type 'Int'"),
  );
});

test("rejects a cyclic @cstruct interface instead of recursing forever", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record A {\n    b: B\n}\n@cstruct record B {\n    a: A\n}\n`,
  );
  assert.throws(
    () => generateBinding(iface, options),
    (error: unknown) =>
      error instanceof BridgeDefinitionError && error.message.includes("cycle"),
  );
});

test("casts each symbol call to the declared TypeScript return type", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Vec2 {\n    x: Int\n    y: Int\n}\nextern func add(a: Int, b: Int) -> Int\nextern func sum(v: Vec2) -> Int\nextern func run() -> Unit\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(source, /return asXzInt\(symbols\["add"\]!\(asXzInt\(a\), asXzInt\(b\)\)\);/);
  assert.match(source, /return asXzInt\(symbols\["sum"\]!\(normalizeVec2\(v\)\)\);/);
  assert.match(source, /symbols\["run"\]!\(\);/);
});

test("wraps Int/usize parameters and returns in asXzInt", async () => {
  const iface = parseInterface(`${EXPORT}extern func echo(n: Int) -> usize\n`);
  const source = generateBinding(iface, options);
  assert.match(source, /import \{[^}]*asXzInt[^}]*\} from "@xz-lang\/bridge"/);
  assert.match(source, /return asXzInt\(symbols\["echo"\]!\(asXzInt\(n\)\)\);/);

  const dir = await mkdtemp(join(tmpdir(), "next-xz-gen-"));
  try {
    const file = join(dir, "liborder.ts");
    await writeFile(file, generateBinding(iface, { ...options, importFrom: bridgeEntry }), "utf8");

    const module = (await import(pathToFileURL(file).href)) as {
      bind(backend: FfiBackend): {
        echo(n: bigint): bigint;
        close(): void;
      };
    };
    const backend: FfiBackend = {
      dlopen: () => ({
        symbols: { echo: (n: unknown) => n },
        close: () => {},
      }),
    };

    const binding = module.bind(backend);
    assert.equal(binding.echo(9007199254740993n), 9007199254740993n);
    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated module loads, calls a symbol, and closes through an injected backend", async () => {
  const iface = parseInterface(`${EXPORT}extern func add(a: Int, b: Int) -> Int\nextern func noop()\n`);
  const source = generateBinding(iface, { ...options, importFrom: bridgeEntry });

  const dir = await mkdtemp(join(tmpdir(), "next-xz-gen-"));
  try {
    const file = join(dir, "liborder.ts");
    await writeFile(file, source, "utf8");

    const module = (await import(pathToFileURL(file).href)) as {
      bind(backend: FfiBackend): {
        add(a: bigint, b: bigint): bigint;
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
            return (a as bigint) + (b as bigint);
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
    assert.equal(binding.add(2n, 3n), 5n);
    binding.noop();
    assert.deepEqual(calls, [[2n, 3n], []]);
    binding.close();
    assert.equal(closed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated module marshals Str/Bytes through the injected backend", async () => {
  const iface = parseInterface(
    `${EXPORT}extern func hash(data: Bytes) -> Int\nextern func greet(name: Str) -> Str\n`,
  );
  const source = generateBinding(iface, { ...options, importFrom: bridgeEntry });

  const dir = await mkdtemp(join(tmpdir(), "next-xz-gen-"));
  try {
    const file = join(dir, "liborder.ts");
    await writeFile(file, source, "utf8");

    const module = (await import(pathToFileURL(file).href)) as {
      bind(backend: FfiBackend): {
        hash(data: Uint8Array): bigint;
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
    assert.equal(binding.hash(borrowed), 3n);
    assert.equal(seen[0]?.ptr, borrowed);

    assert.equal(binding.greet("héllo"), "hello");
    assert.deepEqual([...seen[1]!.ptr], [...new TextEncoder().encode("héllo")]);

    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated module copies a transferred Str and releases the original", async () => {
  const iface = parseInterface(
    `${FOREIGN}extern func free(ptr: Ptr) -> Unit\nextern func strdup(s: Str) -> transfer Str release free\n`,
  );
  const source = generateBinding(iface, { ...options, importFrom: bridgeEntry });

  const dir = await mkdtemp(join(tmpdir(), "next-xz-gen-"));
  try {
    const file = join(dir, "liborder.ts");
    await writeFile(file, source, "utf8");

    const module = (await import(pathToFileURL(file).href)) as {
      bind(backend: FfiBackend): {
        strdup(s: string): string;
        close(): void;
      };
    };

    const encoder = new TextEncoder();
    const freed: Uint8Array[] = [];
    const backend: FfiBackend = {
      dlopen: () => ({
        symbols: {
          strdup: () => ({ ptr: encoder.encode("copy"), len: 4 }),
          free: (ptr: unknown) => {
            freed.push(ptr as Uint8Array);
          },
        },
        close: () => {},
      }),
    };

    const binding = module.bind(backend);
    assert.equal(binding.strdup("source"), "copy");
    assert.equal(freed.length, 1);
    assert.deepEqual([...freed[0]!], [...encoder.encode("copy")]);
    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("generated module releases the backend's original pointer, not its decoded bytes", async () => {
  const iface = parseInterface(
    `${FOREIGN}extern func free(ptr: Ptr) -> Unit\nextern func strdup(s: Str) -> transfer Str release free\n`,
  );
  const source = generateBinding(iface, { ...options, importFrom: bridgeEntry });

  const dir = await mkdtemp(join(tmpdir(), "next-xz-gen-"));
  try {
    const file = join(dir, "liborder.ts");
    await writeFile(file, source, "utf8");

    const module = (await import(pathToFileURL(file).href)) as {
      bind(backend: FfiBackend): {
        strdup(s: string): string;
        close(): void;
      };
    };

    const opaque = { pointer: "raw" };
    const freed: unknown[] = [];
    const backend: FfiBackend = {
      dlopen: () => ({
        symbols: {
          strdup: () => ({ ptr: new TextEncoder().encode("copy"), len: 4, address: opaque }),
          free: (ptr: unknown) => {
            freed.push(ptr);
          },
        },
        close: () => {},
      }),
    };

    const binding = module.bind(backend);
    assert.equal(binding.strdup("source"), "copy");
    assert.equal(freed.length, 1);
    assert.equal(freed[0], opaque);
    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("normalizes Int/usize fields of a @cstruct parameter and return", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Point {\n    x: Int\n    scale: Float\n}\n@cstruct record Line {\n    a: Point\n    b: Point\n}\nextern func sum(v: Line) -> Line\n`,
  );
  const source = generateBinding(iface, options);
  assert.match(
    source,
    /function normalizePoint\(value: Point\): Point \{\n  return \{\n    \.\.\.value,\n    x: asXzInt\(value\.x\),\n  \};/,
  );
  assert.match(source, /function normalizeLine\(value: Line\): Line \{\n  return \{\n    \.\.\.value,\n    a: normalizePoint\(value\.a\),\n    b: normalizePoint\(value\.b\),/);
  assert.match(source, /return normalizeLine\(symbols\["sum"\]!\(normalizeLine\(v\)\) as Line\);/);
});

test("leaves a @cstruct without a 64-bit integer field unnormalized", () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Pt {\n    x: Float\n    y: Float\n}\nextern func f(p: Pt) -> Pt\n`,
  );
  const source = generateBinding(iface, options);
  assert.doesNotMatch(source, /normalizePt/);
  assert.doesNotMatch(source, /asXzInt/);
  assert.match(source, /return symbols\["f"\]!\(p\) as Pt;/);
});

test("normalizes @cstruct fields to bigint on the way in and out at runtime", async () => {
  const iface = parseInterface(
    `${EXPORT}@cstruct record Point {\n    x: Int\n    y: Int\n}\nextern func shift(p: Point) -> Point\n`,
  );
  const source = generateBinding(iface, { ...options, importFrom: bridgeEntry });

  const dir = await mkdtemp(join(tmpdir(), "next-xz-gen-"));
  try {
    const file = join(dir, "liborder.ts");
    await writeFile(file, source, "utf8");

    const module = (await import(pathToFileURL(file).href)) as {
      bind(backend: FfiBackend): {
        shift(p: { x: bigint; y: bigint }): { x: bigint; y: bigint };
        close(): void;
      };
    };

    const seen: unknown[] = [];
    const backend: FfiBackend = {
      dlopen: () => ({
        symbols: {
          shift: (p: unknown) => {
            seen.push(p);
            return { x: 7, y: 9007199254740993n };
          },
        },
        close: () => {},
      }),
    };

    const binding = module.bind(backend);
    const result = binding.shift({ x: 3, y: 4 } as unknown as { x: bigint; y: bigint });
    assert.deepEqual(seen, [{ x: 3n, y: 4n }], "safe-integer numbers widen to bigint before the call");
    assert.equal(result.x, 7n, "a backend number field is widened on the way out");
    assert.equal(result.y, 9007199254740993n, "a bigint field above 2^53 is preserved");
    assert.throws(
      () => binding.shift({ x: 2 ** 53, y: 0n } as unknown as { x: bigint; y: bigint }),
      /expected a 64-bit integer/,
      "an unsafe number field is a hard error",
    );
    binding.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});