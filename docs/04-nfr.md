# 04 — Non-functional requirements

## 1. Safety

- The AI Agent may only write `.xz` and `.xzint` files by default. Editing raw
  TypeScript routing (`app/**/page.tsx`, `app/**/route.ts`), middleware, or
  infrastructure config requires an explicit developer flag.
- Approval of a module with unproven, untrusted claims is blocked unless a
  developer overrides with a recorded note (`xz check --strict` parity).
- The agent never commits. Commits are a human action (P1: triggered by audit
  approval, authored with a message derived from `@intent`).

## 2. Determinism and reproducibility

- Given the same Xz version and source, `xz build --shared` produces identical
  binary behavior.
- `next.xz` pins the Xz compiler version in a lockfile and refuses to bind a
  shared library built by a different version (`BridgeVersionError`).
- The agent records the prompt hash and model version for each run so a result
  is reproducible or explainable.

## 3. Developer ergonomics

- Installing `next.xz` requires zero changes to standard Next.js App Router
  conventions. No custom server, no route rewrites, no config surgery.
- Generated bindings live under a single, predictable directory (default
  `src/xz/`) and are committed, so a fresh clone typechecks without a build
  step.
- The unified CLI is `npx next.xz <command>`; each command maps to a single Xz
  CLI invocation or a bridge action.

## 4. No silent degradation

- A value that cannot cross the C ABI safely is a hard error at generation
  time, never a lossy cast.
- A missing symbol or version mismatch is a thrown, typed error, not a
  fallback.

## 5. Performance

| Path | Budget |
|---|---|
| FFI call overhead | < 0.5 ms, excluding the body |
| `xz check-json` on a module | bounded by the compiler; the agent loop adds no full-file reparse beyond one check per attempt |
| Audit page render | interactive (< 100 ms) for a module list |
| Dev-server startup delta | no measurable change to baseline Next.js |

## 6. Observability

- Every FFI call can emit a structured record: function name, declared effects,
  latency, outcome.
- Every agent run emits attempt count, final status, and diagnostic codes.
- Audit actions are logged (who, when, module, decision, override note).

## 7. Compatibility

| Target | Support |
|---|---|
| Node.js | ≥ 20, FFI via `koffi` or N-API addon |
| Bun | `bun:ffi` |
| Vercel Node runtime | supported (native `.so`) |
| Vercel Edge runtime | Phase 4 (Wasm) |
| OS | Linux, macOS, Windows (shared-object suffix per platform) |
| Next.js | App Router, current stable |

## 8. Security

- The bridge never executes Xz source at runtime; it only loads compiled,
  approved shared objects.
- `.xzint` files fetched from a registry are untrusted until they pass the same
  checks `xz pkg gen` applies (lex, parse, validate, resolve, typecheck).
- No secrets are embedded in generated bindings; configuration is read from the
  environment at load time.
