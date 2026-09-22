# Architecture

This document specifies how `next.xz` is put together: the components, the
interfaces between them, and the data that flows across each boundary. It
assumes the Xz language surfaces described in the
[Xz specification](https://github.com/x1zzdev/Xz).

## 1. Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ Layer A — Next.js application (developer-owned)                     │
│   App Router · React Server Components · Server Actions · Tailwind  │
└───────────────┬─────────────────────────────────────────────────────┘
                │  import { payableTotal } from "@/xz/order"
                │  (generated, typed binding)
┌───────────────▼─────────────────────────────────────────────────────┐
│ Layer B — @xz-lang/bridge (generated + runtime)                     │
│   binding generator · FFI loader · marshalling · error mapping      │
└───────────────┬─────────────────────────────────────────────────────┘
                │  C ABI symbols
┌───────────────▼─────────────────────────────────────────────────────┐
│ Layer C — Xz shared library (compiled artifact)                     │
│   @export functions · @cstruct layouts · libc runtime               │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ Layer D — @xz-lang/agent (dev-time, Node/Bun process)               │
│   prompt builder · xz check-json driver · repair loop · retry budget│
└───────────────┬─────────────────────────────────────────────────────┘
                │  reads diagnostics, writes .xz
┌───────────────▼─────────────────────────────────────────────────────┐
│ Layer E — @xz-lang/audit (dev-time Next.js route /___audit)         │
│   AST effect extraction · badge rendering · approval action         │
└─────────────────────────────────────────────────────────────────────┘
```

Layers B and C are the production path. Layers D and E are development-time
tooling that never ship to production.

## 2. Component contracts

### 2.1 `@xz-lang/bridge`

Inputs: an `.xzint` interface file or a `.xz` source with `@export` functions.
Outputs: a TypeScript module with typed functions and a loader.

```ts
// generated: src/xz/order.ts
export function payableTotal(subtotal: number, taxRate: number): number;

// generated: src/xz/_loader.ts
// Loads .next-xz/liborder.so via bun:ffi (Bun) or koffi (Node).
// Throws BridgeVersionError if the library's xz version != the pinned one.
```

Rules:

- Only `@export` symbols are bound. Non-exported functions keep internal
  linkage and are unreachable.
- The generator lives in `@xz-lang/bridge` and is canonical; the Xz CLI does
  not emit TypeScript (see [docs/01-bridge.md](docs/01-bridge.md) §2.1). It
  mirrors `xz bind --lang python`: it reads the same `@export` signatures and
  `@cstruct` records, and emits a wrapper named after the source stem.
- A signature that is not C-representable is a generator error, not a warning.
  This matches the compiler's own rule for `@export`.
- `Result` cannot cross the C ABI. A C-representable Xz wrapper is required;
  the TypeScript binding maps its status/out-parameter back to a thrown typed
  error. See [docs/01-bridge.md](docs/01-bridge.md).

### 2.2 `@xz-lang/agent`

Inputs: an intent specification (natural language + optional contract shell).
Outputs: a `.xz` file, a diagnostic history, and a terminal status
(`passed` | `escalated`).

```
intent ──► prompt ──► LLM ──► candidate.xz
                                  │
                                  ▼
                          xz check-json
                          │           │
                     errors?       zero errors
                          │           │
                          ▼           ▼
                    repair prompt   hand to audit
                          │
                          └──► retry (≤ N)
```

Rules:

- The loop is bounded by N (default 3). On exhaustion it stops and escalates;
  it never silently accepts a failing module.
- Only diagnostics whose `span` intersects the current edit target are injected
  (P1), ranked by `suggestion.confidence`.
- The agent may write `.xz` files and `.xzint` interface files. It may not edit
  `app/**/page.tsx`, `app/**/route.ts`, middleware, or config without an
  explicit developer flag.
- Every iteration is recorded so the audit view can show the path taken.

### 2.3 `@xz-lang/audit`

Inputs: the approved-candidate `.xz` file and the diagnostic run that cleared
it.
Outputs: an approval event that triggers `xz build --shared` and a commit.

Data rendered per module:

| Field | Source |
|---|---|
| Signature | Xz source (compiler AST dump planned) |
| `@intent` prose | doc comment |
| Declared `@effects` | doc comment |
| Derived `@effects` | compiler effect derivation |
| `@trusted` stamps | doc comment, with review note |
| Diff | git against the last approved revision |

## 3. Type mapping across the bridge

Xz ↔ C (authoritative, from the Xz spec):

| Xz | C | TypeScript binding |
|---|---|---|
| `Bool` | `bool` (i8 in memory, i1 in registers) | `boolean` |
| `Int` | `int64_t` | `number` (or `bigint` when > 2^53) |
| `usize` | `uint64_t` | `number` / `bigint` |
| `Float` | `double` | `number` |
| `Char` | `char` | `string` (length 1) |
| `Str` | `XzStr { const char* ptr; size_t len; }` | `string` (encoded) or `Uint8Array` (zero-copy, P1) |
| `Bytes` | `XzBytes { uint8_t* ptr; size_t len; }` | `Uint8Array` |
| `Ptr` | `void*` | `unknown` opaque handle (never copied) |
| `@cstruct record` | C `struct`, declaration order | `{ ... }` object |
| `Result` / `Option` | not C-representable | mapped by a contracted wrapper (§2.1) |
| `List` / `Map` / `Set` / `enum` / plain `record` / `Chan` | not C-representable | rejected at generation time |

## 4. Effect badges

Xz derives a function's effect profile transitively over calls. The audit UI
maps the derived labels to reviewer-facing badges:

| `@effects` label | Badge | Reviewer question answered |
|---|---|---|
| `none` | `PURE` | "What can it change?" → nothing |
| `mut` | `MUTATES_STATE` | "What can it change?" → explicit local mutation |
| `io` | `IO` / `NETWORK_OUT` | "What can it change?" → filesystem/clock/network |
| `chan` | `CONCURRENCY` | "What can it change?" → inter-task messages |
| `extern` | `EXTERNAL_FFI` | "What can it change?" → foreign code |

A declared/derived mismatch is a compile error (`I0020`); the badge therefore
always reflects the body, not just the claim.

## 5. Failure model

- **Compile-time:** `xz check-json` returns a JSON array of diagnostics with
  stable codes (`L`/`P`/`R`/`T`/`I` prefixes), spans, categories, and suggested
  fixes. This is the only feedback channel the agent uses.
- **Generation-time:** a non-C-representable `@export` or missing `.xzint`
  symbol is a hard error; the bridge refuses to emit a lossy binding.
- **Runtime:** approved modules return `Result`; the wrapper maps the error
  channel to a typed exception at the Server Action boundary. An unhandled
  `err` reaching `main` is printed to stderr and exits non-zero — the one error
  path the runtime owns.

## 6. Determinism

Given the same Xz version and source, `xz build --shared` produces identical
binary behavior. `next.xz` pins the compiler version in a lockfile and refuses
to bind a shared library built by a different version.

## 7. Trust boundaries

| Boundary | Trusted side | Rule |
|---|---|---|
| LLM → `.xz` source | neither | compiler verifies before use |
| `.xz` → shared library | compiler | only `@export`, C-representable |
| `.so` → TypeScript binding | generator | version-pinned, no lossy casts |
| Agent → app files | developer | agent blocked without a flag |
