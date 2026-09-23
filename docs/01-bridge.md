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
it. The CLI emits the Python binding; `@xz-lang/bridge` emits the TypeScript
binding.

```
liborder.xzint ──► xz pkg gen --lang python         (Xz CLI)
              └──► @xz-lang/bridge generateBinding   (TypeScript)
                        │
                        ▼
                  src/xz/liborder.ts
```

The generator parses the same `.xzint` grammar the CLI's `--lang python` target
consumes, and:

- emits a module named after the interface stem,
- declares each `@cstruct` as a TypeScript interface with matching field order,
- types every `extern`/`@export` function,
- records the shared object named by `--lib` (default: stem + platform suffix)
  in a manifest and emits a `bind(backend)` factory (§6), so the same module
  loads on Bun or Node.

### 2.1 Why the generator lives in the bridge

There is one TypeScript binding generator, and it is `@xz-lang/bridge`. The Xz
CLI does not grow a `--lang ts` target.

`xz pkg gen --lang python` can emit a self-contained `ctypes` module with no
external runtime. A TypeScript wrapper cannot be self-contained: it imports the
bridge runtime (`loadLibrary`, `FfiBackend`, `LibraryManifest`) and emits a
`bind(backend)` factory that is meaningful only against that runtime, across
two FFI backends (`bun:ffi`, `koffi`). Emitting it from the Rust CLI would
duplicate the bridge's public API and manifest shape in a second language, and
the two would drift. The bridge generator is the single source of truth; the
CLI keeps `--lang python` and the interface checks both paths share.

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
struct; the binding encodes on call and decodes on return. `Bytes` crosses as
an `XzBytes` struct wrapping the caller's `Uint8Array` view.

Ownership is explicit in the interface: a parameter is borrowed by default —
the callee may not retain the pointer past the call — and an `extern func`
parameter marked `transfer` moves ownership to the callee
([Xz docs/10](https://github.com/x1zzdev/Xz/blob/main/docs/10-ffi-interop.md)).
The generated binding wraps the view for the call and, for `transfer`, retains
the backing buffer on the binding until `close()`: the buffer is never copied,
and it stays alive as long as the callee may hold the pointer. It never passes
a borrowed buffer to a callee that may retain it, and it rejects a `transfer`
of a non-buffer type.

A return is owned by the callee by default: the caller borrows it and must not
free it. A `transfer` return (`-> transfer T`, [Xz
docs/10](https://github.com/x1zzdev/Xz/blob/main/docs/10-ffi-interop.md)) moves
ownership to the caller, but the generated binding cannot take it: it copies
the returned buffer into a JavaScript value and has no library deallocator to
release the original, so it rejects a `transfer` return rather than leak the
buffer.

`Str`/`Bytes` are marshalled at top level only. A `@cstruct` field of either
type, a `Ptr` or handle record handed off with `transfer`, and by-value payloads
remain hard errors until the generator emits their marshalling.

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
      return symbols["payableTotal"]!(subtotal, taxRate) as number;
    },
    close: () => loaded.close(),
  };
}
```

The current generator emits bindings only for signatures it can marshal
faithfully: scalars (`Bool`, `Int`, `usize`, `Float`, `Char`), `Ptr`,
`@cstruct` records of those, and top-level `Str`/`Bytes` (encode/decode, with
`transfer` parameter retention per §4.2). `mut` out-parameters (the `Result`
contract wrapper, §5), `Str`/`Bytes` as `@cstruct` fields, a `transfer` return,
and `transfer` of `Ptr` or a handle record are hard errors, not lossy output,
until the generator emits their marshalling.

Before it emits anything, the generator validates the whole interface in one
pass: `validateInterface` reports every declaration that is not C-representable
— a generic `Result`/`Option`/collection, `Unit` outside a return, an undeclared
record, or a cyclic `@cstruct` — instead of failing type by type. It also
rejects a `@cstruct` name declared more than once, rather than letting the later
declaration silently replace the earlier one, and an `extern func` name declared
more than once for the same reason. It also rejects a `@cstruct` name
that collides with a built-in type name (`Bool`, `Int`, `usize`, `Float`,
`Char`, `Str`, `Bytes`, `Ptr`, `Unit`): a reference to that name would silently
resolve to the primitive and ignore the record, so the collision is a definition
error. This is the same
C-representability rule the compiler applies to `@export`. A `Str`/`Bytes`
`@cstruct` field is C-representable and passes this check; the generator rejects
it separately because the binding does not marshal it. `manifestFromInterface`
runs the same pass and refuses to build a symbol table from an interface with any
problem, so a duplicate function name can never silently overwrite the earlier
symbol. `validateInterface` is the single owner of the C-representability and
cycle rules: `mapXzTypeToFfi` and `mapTypeToTs` perform structural mapping only
and assume the interface already passed that pass, so the manifest path and the
generator cannot disagree about what is representable. A mapping helper that is
called without validation throws `BridgeDefinitionError` as an internal
invariant violation, not a rule message.

## 7. Performance budget

FFI overhead target: **< 0.5 ms** per call, excluding the body. This rules out
per-call `dlopen`, per-call marshalling of large buffers, and per-call JSON.
The benchmark suite in Phase 1 measures native TS vs. Xz FFI for a fixed set of
functions.

## 8. Open questions

- Where the TypeScript generator lives is settled (§2.1): in
  `@xz-lang/bridge`, not the Xz CLI.
- Zero-copy ownership rules for retained pointers are expressed by the
  `transfer` parameter modifier on `extern func` ([Xz
  docs/10](https://github.com/x1zzdev/Xz/blob/main/docs/10-ffi-interop.md)).
  The binding now emits the handoff for top-level `Str`/`Bytes` by retaining the
  caller's buffer until `close()` (§4.2). Whether an FFI backend exposes a
  returned struct field as a byte view (rather than an opaque pointer) is
  unverified without a real `.so`; `koffi`/Bun smoke tests are outstanding.
- A `transfer` return (`-> transfer T`) moves ownership to the caller, but the
  binding has no library deallocator to release a returned buffer, so it rejects
  the modifier (as the Python wrapper does). Honoring it needs a declared
  release symbol in the interface; that contract is not specified yet.
- Edge runtime requires Wasm, which changes the loading story entirely.
