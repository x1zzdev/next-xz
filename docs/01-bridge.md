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
- The generated header is an honest, complete description of the ABI. It states
  the ownership convention too: a parameter is borrowed for the call, and a
  returned pointer is retained by the library. An `@export` function cannot use
  `transfer` (a foreign `extern func` modifier only), so ownership never varies
  across exports and no per-symbol annotation is needed.

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
consumes, plus the bridge-side `release` clause (§4.2), and:

- emits a module named after the interface stem,
- declares each `@cstruct` as a TypeScript interface with matching field order,
- types every `extern`/`@export` function,
- records the shared object named by `--lib` (default: stem + platform suffix)
  in a manifest and emits a `bind(backend)` factory (§6), so the same module
  loads on Bun or Node.

### 2.1 Interface kind

Every `.xzint` opens with exactly one interface-kind marker on its own line:

```
@interface export
```

```
@interface foreign
```

The marker is the single source of truth for the ownership regime. It is not
inferred from the declarations: both kinds declare functions with the same
`extern func` syntax, so the keyword cannot tell them apart.

- `@interface export` declares the C ABI surface an Xz shared library
  **exports** — the signatures of the `@export` functions in a `.xz` source. A
  parameter is borrowed and a return is retained by the library; `transfer` and
  `release` are definition errors (§4.2).
- `@interface foreign` declares a **foreign C library's** symbols, the form
  `xz pkg add` distributes and `xz pkg gen --lang python` consumes. `transfer`
  is legal in both directions, and a `transfer` return carries a
  `release <symbol>` clause (§4.2).

A file with no marker, or with more than one, is a definition error: the
parser never guesses the boundary kind. The marker's grammar is owned by Xz
(§8). The parser reads it as the first token and refuses a missing, duplicate,
or unknown marker; `validateInterface` and the generator key their ownership
rules to it.

### 2.2 Why the generator lives in the bridge

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

`loadBunLibrary` and `loadNodeLibrary` pin a backend explicitly.
`loadPlatformLibrary` selects one at runtime instead: it picks the `bun:ffi`
backend when a `Bun` global is present and the koffi backend otherwise, so the
same generated module loads on either runtime without the caller supplying a
backend (§6). The backend is the only thing that varies per platform; the
returned `LoadedLibrary` is identical.

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
register its layout. An `int64`/`uint64` symbol crosses as `bigint` (§4.1);
whether a backend accepts and returns `bigint` for a 64-bit type, rather than a
lossy `number`, is unverified without a real `.so` (§8).

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

`Bool` → `boolean`, `Int`/`usize` → `bigint`, `Float` → `number`, `Char` →
single-character `string`.

`Int`/`usize` are 64-bit ABI integers (`int64_t`/`uint64_t`). A JavaScript
`number` holds integers only up to 2^53, so exposing one would silently lose
precision above that range; the binding exposes `bigint` instead, the only
exact JavaScript representation. Every value the binding sees is normalized by
`asXzInt`: a `bigint` passes through, a safe-integer `number` (a backend that
reports small 64-bit values as `number`) is widened exactly, and any other
value — a fractional number or one beyond 2^53 — is a hard error, never a lossy
cast. This mirrors the Python wrapper, which maps `Int` to the exact `int`.

### 4.2 `Str` / `Bytes`

Default (P0): encode/decode. `Str` crosses as UTF-8 bytes into an `XzStr`
struct; the binding encodes on call and decodes on return. `Bytes` crosses as
an `XzBytes` struct wrapping the caller's `Uint8Array` view.

Ownership depends on the interface kind (§2.1). A parameter is borrowed by
default — the callee may not retain the pointer past the call. `transfer` is a
C ABI ownership declaration ([Xz
docs/10](https://github.com/x1zzdev/Xz/blob/main/docs/10-ffi-interop.md)): it is
legal only where a foreign C callee takes ownership.

- In `@interface foreign` a `transfer` parameter is legal: the binding encodes
  the buffer and hands it to the C callee, which owns it afterward. Because the
  callee may keep the pointer past the call while a JavaScript `string` or
  `Uint8Array` is garbage-collected, the binding pushes the encoded buffer onto a
  `retained` list and releases it only when `close()` clears the list, so the
  pointer stays valid for the library's lifetime. Only a top-level `Str`/`Bytes`
  transfer parameter is emitted; a `Ptr` or handle `@cstruct` transfer has no
  backing buffer to retain and is a hard error (§4.4).
- In `@interface export` a `transfer` parameter is a definition error: Xz
  forbids `transfer` on `@export`, so the interface cannot describe an Xz
  library that takes ownership from its C caller. The generator rejects it
  rather than emit a handoff the Xz side cannot honor.

A borrowed buffer is never handed to a callee that may retain it.

A return is owned by the callee by default: the caller borrows it and must not
free it. A `transfer` return (`-> transfer T`, [Xz
docs/10](https://github.com/x1zzdev/Xz/blob/main/docs/10-ffi-interop.md)) moves
ownership to the caller, so the caller must release the buffer through the
library's deallocator. Only `@interface foreign` may declare one: Xz forbids a
`transfer` return on `@export`, so in `@interface export` it is a definition
error. The interface names the deallocator on the symbol:

```
extern func free(ptr: Ptr) -> Unit
extern func strdup(s: Str) -> transfer Str release free
```

The release symbol is declared in the same interface as a function taking one
borrowed `Ptr` and returning `Unit`. The binding copies the returned buffer into
a JavaScript value, then calls the release symbol with the returned `ptr` in a
`finally` path, so a decode failure cannot leak it. A `transfer` return without
a `release` clause is a hard error, and a `release` clause on a return that is
not `transfer` is a definition error: a buffer is never silently leaked or
freed twice. Only a top-level `Str`/`Bytes` return has a release path; a
pointer-carrying `@cstruct` handle return is still rejected (§4.4).

The `release` clause is a bridge-side `.xzint` extension that appears only in an
`@interface foreign`. The generator parses and emits it, but the grammar is
owned by Xz (§2.2): the clause must be added to Xz docs/11, `validate_interface`,
and `xz pkg gen --lang python` before an interface that uses it is portable to
the CLI (§8).

`Str`/`Bytes` are marshalled at top level only. A `@cstruct` field of either
type and by-value payloads remain hard errors until the generator emits their
marshalling.

### 4.3 `@cstruct`

Generated as a TypeScript interface with the same field order and alignment
semantics. Nested `@cstruct` records nest as objects.

### 4.4 Handles

A `@cstruct` containing a `Ptr` is a handle type: never copied, handed off only
with `transfer`. The generator rejects a `transfer` handle in both directions —
the release contract (§4.2) covers only a top-level `Str`/`Bytes` return — so a
handle is not yet emitted. The TypeScript binding would expose it as an opaque
object whose methods route back into the library; it is not a plain value
object.

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
and returns the typed facade, plus a `loadPlatform()` entry that calls
`loadPlatformLibrary` to pick the backend from the runtime (§3). Binding is
explicit so the runtime can inject the Bun or Node backend; `loadPlatform()`
takes no backend, and the backend is the only thing that varies per platform.

```ts
// src/xz/order.ts (generated — do not edit)
import {
  loadLibrary,
  loadPlatformLibrary,
  type FfiBackend,
  type LibraryManifest,
  type LoadedLibrary,
} from "@xz-lang/bridge";

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
  return createBinding(
    loadLibrary(manifest, { expectedXzVersion: manifest.xzVersion, backend }),
  );
}

export async function loadPlatform(): Promise<Binding> {
  return createBinding(
    await loadPlatformLibrary(manifest, { expectedXzVersion: manifest.xzVersion }),
  );
}

function createBinding(loaded: LoadedLibrary): Binding {
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
`@cstruct` records of those, and top-level `Str`/`Bytes` (encode/decode,
borrowed for the call, §4.2). Each `Int`/`usize` argument and return is passed
through `asXzInt` (§4.1), so the boundary always hands back a `bigint` rather
than a possibly-rounded `number`. `mut` out-parameters (the `Result` contract
wrapper, §5), a `transfer` parameter that is not a top-level `Str`/`Bytes`, a
`transfer` return without a declared `release` symbol, `Str`/`Bytes` as
`@cstruct` fields, and by-value payloads are hard errors, not lossy output,
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
error. A `transfer` parameter is accepted in an `@interface foreign` (a foreign C
callee may take ownership) but rejected outright in an `@interface export` (§2.1,
§4.2): Xz permits `transfer` only on a foreign `extern func`, and an `@export`
function cannot accept ownership from the C caller. It rejects a `transfer`
return whose type is not pointer-carrying (`Str`, `Bytes`, `Ptr`, or a `@cstruct`
record with a `Ptr` field), the compiler's ownership rule; a scalar has no
ownership to transfer, and a `transfer` return in an `@interface export` is a
definition error regardless. It also checks the `release` clause of §4.2: the
named symbol must be an `extern func` declared in the same interface with exactly
one borrowed `Ptr` parameter and a `Unit` return, a `transfer` return must carry
one, and a clause on a non-`transfer` return is a definition error. The bridge
implements this clause ahead of Xz (it is a `.xzint` extension, §4.2), so a
`transfer` return is accepted with a valid release symbol and rejected without
one rather than leaked. `mut` and `transfer` are already mutually exclusive in
the grammar. This is the
same C-representability rule the compiler applies to `@export`. A `Str`/`Bytes`
`@cstruct` field is C-representable and passes this check; the generator rejects
it separately because the binding does not marshal it. `manifestFromInterface`
runs the same pass and refuses to build a symbol table from an interface with any
problem, so a duplicate function name can never silently overwrite the earlier
symbol. `generateBinding` delegates validation to `manifestFromInterface` rather
than running the pass itself, so the normal path validates the interface exactly
once before applying its generator-specific marshalling checks; a validation
problem is reported before any marshalling rejection. `validateInterface` is the
single owner of the C-representability and
cycle rules: `mapXzTypeToFfi` and `mapTypeToTs` perform structural mapping only
and assume the interface already passed that pass, so the manifest path and the
generator cannot disagree about what is representable. The two mapping helpers
stay public as structural utilities (they mirror each other), but a direct call
is unsupported: the validated entry points are `manifestFromInterface` and
`generateBinding`. A mapping helper that is called without validation throws
`BridgeDefinitionError` as an internal invariant violation, not a rule message;
the FFI helper's contract is pinned by tests. No standalone per-type
representability predicate is exported; a caller that needs to know whether a
declaration is C-representable reads the `validateInterface` problem list
instead of re-deriving the rule.

## 7. Performance budget

FFI overhead target: **< 0.5 ms** per call, excluding the body. This rules out
per-call `dlopen`, per-call marshalling of large buffers, and per-call JSON.
The benchmark suite in Phase 1 measures native TS vs. Xz FFI for a fixed set of
functions.

## 8. Open questions

- Where the TypeScript generator lives is settled (§2.2): in
  `@xz-lang/bridge`, not the Xz CLI.
- Zero-copy ownership rules for retained pointers are expressed by the
  `transfer` parameter modifier on `extern func` ([Xz
  docs/10](https://github.com/x1zzdev/Xz/blob/main/docs/10-ffi-interop.md)).
  Whether a `transfer` is legal depends on the interface kind (§2.1): an
  `@interface foreign` may declare one, an `@interface export` may not, because
  an Xz `@export` surface cannot take ownership. Emitting a retained handoff
  still needs a memory model that accepts the C caller's ownership (§4.2).
  Whether an FFI backend exposes a returned struct field as a byte view (rather
  than an opaque pointer) is unverified without a real `.so`; `koffi`/Bun smoke
  tests are outstanding.
- A `transfer` return (`-> transfer T`) moves ownership to the caller. The
  deallocator contract is settled (§4.2): the symbol carries a `release <symbol>`
  clause, the named `extern func` takes one borrowed `Ptr` and returns `Unit`,
  and the binding copies the returned buffer then frees it through that symbol.
  The bridge parser, validator, and generator implement the clause. Portability
  is the open part: the grammar is owned by Xz (§2.2), so Xz docs/11, the CLI's
  `validate_interface`, and `xz pkg gen --lang python` must accept the clause
  before an interface using it is portable; the Python wrapper still rejects a
  `transfer` return ([Xz
  docs/10](https://github.com/x1zzdev/Xz/blob/main/docs/10-ffi-interop.md)).
- The interface-kind marker is settled and implemented (§2.1): a mandatory
  `@interface export` or `@interface foreign` line states whether the file
  describes an Xz `@export` surface or a foreign C library, and the parser,
  validator, and generator key the ownership rules to it. Portability is the
  open part: the marker is a bridge-side extension ahead of the grammar owner,
  so Xz docs/11 and `validate_interface` must accept it (with the `release`
  clause) before an interface that uses them is portable to the CLI.
- Edge runtime requires Wasm, which changes the loading story entirely.
