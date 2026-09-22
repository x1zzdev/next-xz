# 01 — FFI and TypeScript bridge

`@xz-lang/bridge` turns an Xz shared library into a typed TypeScript module that
a Next.js Server Action can import directly.

## 1. What the Xz side guarantees

From the Xz FFI spec:

- `xz build --shared <file.xz>` emits a shared object plus a C header for the
  functions marked `@export`. Everything else keeps internal linkage.
- An exported signature must be C-representable end to end: `Bool`, `Int`,
  `usize`, `Float`, `Char`, `Str`, `Bytes`, `Ptr`, or a `@cstruct record`,
  with `Unit` allowed only as the return. A `Result`, `Option`, `List`, `Map`,
  `Set`, `Chan`, `enum`, or plain `record` has no C declaration and is
  rejected.
- `Str`/`Bytes` cross as two-field structs (pointer + length). `mut`
  parameters map to `T*` (C in/out).
- The generated header is an honest, complete description of the ABI.

The bridge consumes exactly this surface. It never reads Xz source to guess a
layout; it reads the generated header or the `.xzint` interface.

## 2. Interface-first workflow

Preferred: declare the boundary in a `.xzint` file and generate both sides from
it.

```
liborder.xzint ──► xz pkg gen --lang python   (existing)
              └──► xz pkg gen --lang ts        (planned)
                        │
                        ▼
                  src/xz/liborder.ts
```

`xz pkg gen --lang ts` mirrors the existing `--lang python` target:

- emits a module named after the interface stem,
- declares each `@cstruct` as a TypeScript interface with matching field order,
- types every `extern`/`@export` function,
- records the shared object named by `--lib` (default: stem + platform suffix)
  in a manifest and emits a `bind(backend)` factory (§6), so the same module
  loads on Bun or Node.

Until `--lang ts` ships, `@xz-lang/bridge` provides a generator that parses the
same `.xzint` grammar and emits the same shape, so the CLI and the toolkit stay
interchangeable.

## 3. Loading the library

| Runtime | Mechanism | Notes |
|---|---|---|
| Bun | `bun:ffi` `dlopen` + `FFIType` | Fastest path; native in the runtime. |
| Node | `koffi` (default) or an N-API addon | `koffi` is the current practical FFI for Node; the addon path is for hot functions. |
| Vercel Edge | Wasm (Phase 4) | Native `.so` is not available on the Edge runtime. |

The loader:

1. resolves the shared object path from the generated metadata,
2. verifies the Xz compiler version recorded in the metadata,
3. registers each symbol with its C signature,
4. returns a typed facade.

A version mismatch throws `BridgeVersionError`. A missing symbol throws
`BridgeSymbolError`. Both are actionable, not silent.

### 3.1 Library metadata

The loader consumes a `LibraryManifest`: the shared-object path, the Xz compiler
version the object was built with, and one C signature per symbol. The manifest
is what the generator records alongside the `.so`; the loader never guesses a
layout from source. A `mut` parameter is recorded as a pointer (`T*`), matching
the C in/out convention.

The signature is expressed in backend-neutral FFI types (`bool`, `int64`,
`uint64`, `double`, `char`, `ptr`, `void`, and named structs), so the Bun and
Node loaders share one description. `Str`/`Bytes` are the `XzStr`/`XzBytes`
pointer/length structs. A struct carries its field names so a backend can
register its layout.

`bun:ffi` registers only scalar and pointer FFIType values; it cannot declare a
struct passed by value. A symbol whose signature contains `Str`, `Bytes`, or a
`@cstruct` therefore fails at load time with `BridgeRuntimeError`. The loader
never degrades the signature silently.

The Node loader over `koffi` declares by-value structs, so `Str`/`Bytes`/
`@cstruct` symbols load and call on Node: `koffi.struct` registers each layout
(inner records first) and the registered type is used in the function
signature. The two runtimes therefore differ in capability, not in API: a
program that needs struct-valued exports must run on Node until `bun:ffi` gains
by-value struct support.

The encode/decode of a JavaScript `string` or `Uint8Array` into an `XzStr`/
`XzBytes` value belongs to the generated binding (§4.2), not the loader.

## 4. Marshalling

### 4.1 Scalars

`Bool` → `boolean`, `Int`/`usize` → `number` (with `bigint` for values beyond
2^53), `Float` → `number`, `Char` → single-character `string`.

### 4.2 `Str` / `Bytes`

Default (P0): encode/decode. `Str` crosses as UTF-8 bytes into an `XzStr`
struct; the binding encodes on call and decodes on return.

P1 zero-copy: for `Bytes` and `@cstruct` payloads, pass a `Uint8Array`'s
backing buffer directly and pin it for the duration of the call, avoiding a
copy. Ownership rules must be explicit: the Xz side may not retain a pointer
past the call unless the contract says so.

### 4.3 `@cstruct`

Generated as a TypeScript interface with the same field order and alignment
semantics. Nested `@cstruct` records nest as objects.

### 4.4 Handles

A `@cstruct` containing a `Ptr` is a handle type: never copied, handed off only
with `transfer`. The TypeScript binding exposes it as an opaque object whose
methods route back into the library; it is not a plain value object.

## 5. The `Result` problem

A C ABI export cannot carry a `Result`. Three sanctioned patterns, in order of
preference:

1. **Contracted wrapper (default).** Write a thin `@export` Xz function whose
   signature is C-representable and whose contract documents the mapping, e.g.
   an out-parameter `mut` status plus a value. The binding re-raises a typed
   error.

   ```
   /// @intent  Parses an amount; writes the value and returns a status code.
   /// @effects none
   @export func parse_amount(text: Str, mut out: Float) -> Int
       post result >= 0
   {
       ...   // 0 = ok, >0 = error code
   }
   ```

2. **Status + last-error accessor.** A library-scoped error slot read by a
   companion `@export` function.

3. **CPython-style shim (future).** A generated shim that maps `Result` to a
   language-native exception. This is the long-term clean path for Node too,
   via an N-API addon.

The bridge always surfaces the mapping in the generated TypeScript signature,
so a caller cannot forget to check it. The runtime primitives are
`runContracted(descriptor, invoke, readValue)` and the `XzContractError` it
throws: `invoke` performs the raw call and returns the status code, `readValue`
recovers the out-parameter, and a status other than `descriptor.okCode` raises
with the declared error name (or the bare numeric code when none is declared).
A reader that runs only on the ok path means the out value is never trusted
after an error.

## 6. Generated module shape

The generator emits one module per interface, named after its stem. It declares
each `@cstruct` as a TypeScript interface, records the manifest, and exposes a
`bind(backend)` factory that loads the shared object through the given `FfiBackend`
and returns the typed facade. Binding is explicit so the runtime can inject the
Bun or Node backend, and the backend is the only thing that varies per platform.

```ts
// src/xz/order.ts (generated — do not edit)
import { loadLibrary, type FfiBackend, type LibraryManifest } from "@xz-lang/bridge";

export interface Color { r: number; g: number; b: number; a: number }

export const manifest: LibraryManifest = {
  name: "order",
  path: ".next-xz/liborder.so",
  xzVersion: "0.1.0",
  symbols: {
    "payableTotal": { args: ["int64", "int64"], returns: "int64" },
  },
};

export interface Binding {
  payableTotal(subtotal: number, taxRate: number): number;
  close(): void;
}

export function bind(backend: FfiBackend): Binding {
  const loaded = loadLibrary(manifest, { expectedXzVersion: manifest.xzVersion, backend });
  const symbols = loaded.symbols as Readonly<Record<string, (...args: unknown[]) => unknown>>;
  return {
    payableTotal(subtotal, taxRate) {
      return symbols["payableTotal"]!(subtotal, taxRate);
    },
    close: () => loaded.close(),
  };
}
```

The current generator emits bindings only for signatures it can marshal
faithfully: scalars (`Bool`, `Int`, `usize`, `Float`, `Char`), `Ptr`, and
`@cstruct` records of those. `Str`/`Bytes` encode/decode and `mut` out-parameters
(the `Result` contract wrapper, §5) are hard errors, not lossy output, until the
generator emits their marshalling.

## 7. Performance budget

FFI overhead target: **< 0.5 ms** per call, excluding the body. This rules out
per-call `dlopen`, per-call marshalling of large buffers, and per-call JSON.
The benchmark suite in Phase 1 measures native TS vs. Xz FFI for a fixed set of
functions.

## 8. Open questions

- Should `--lang ts` live in the Xz CLI or in `@xz-lang/bridge`? (Current plan:
  the CLI, with the bridge generator as a compatible fallback.)
- Zero-copy ownership rules for retained pointers need a contract syntax that
  `.xzint` cannot currently express.
- Edge runtime requires Wasm, which changes the loading story entirely.
