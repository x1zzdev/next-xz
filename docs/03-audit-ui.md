# 03 — Human audit interface

`@xz-lang/audit` renders AI-generated Xz modules as reviewable cards on the
Next.js dev server, so a human can approve or reject in seconds.

## 1. Route

The dev server mounts the audit UI at `/___audit` (triple underscore, matching
Next.js's reserved-namespace convention so it never collides with app routes).
In production the route is absent; audit is a development-only surface.

```
/___audit              → list of modules awaiting approval
/___audit/[module]     → one module: badges, contract, diff, actions
```

The package exposes the route as framework-agnostic handlers bound to an
`AuditRegistry`: the list answers the modules awaiting a decision
(`pending`/`blocked`) as JSON, and the module handler answers one card or 404.
A Next.js App Router route re-exports them; React rendering is a separate
deliverable.

## 2. The Audit Card

Each card answers the four reviewer questions directly:

| Reviewer question | Card element | Source |
|---|---|---|
| What does it do? | `@intent` prose + rendered signature | doc comment + Xz AST |
| What can it change? | Effect badges | compiler-derived effects |
| What are its guarantees? | `pre`/`post` list, `@trusted` stamps | doc comment + contract checker |
| What can go wrong? | `Result` error channel + diagnostics history | type signature + `xz check-json` |

## 3. Effect badges

Badges are derived from the compiler's transitive effect derivation, not from
the declared `@effects` alone. A mismatch is a compile error (`I0020`), so a
badge always describes the real body.

| `@effects` | Badge | Color intent |
|---|---|---|
| `none` | `PURE` | green |
| `mut` | `MUTATES_STATE` | amber |
| `io` | `IO` / `NETWORK_OUT` | blue |
| `chan` | `CONCURRENCY` | purple |
| `extern` | `EXTERNAL_FFI` | red |

A function whose declared effects match the derived profile shows a single
badge. A function carrying an unproven `@trusted` claim shows a distinct
"trusted" marker so the human sees the proof gap, not just the claim.

## 4. Diff view

The card shows the candidate source against the last approved revision:

- added/removed lines,
- changed contract lines highlighted (a claim change is as important as a body
  change),
- the diagnostic run that cleared the candidate (attempt count, final codes).

## 5. Approval action

P0: approval is recorded (status change + audit log entry).
P1: one-click approval triggers:

1. `xz build --shared --out <path> <module>.xz`,
2. regeneration of the TypeScript binding,
3. a git commit with a message derived from `@intent`.

Approval is blocked when `xz check --strict` reports unproven, untrusted claims,
unless a developer explicitly overrides with a recorded note.

## 6. Extraction pipeline

```
.xz source ──► xz check-json (diagnostics + spans)
          ──► effect derivation (transitive)
          ──► AST/doc extraction (@intent, @requires, @ensures, @trusted)
          ──► Audit Card model
```

The AST-based extraction tool is the Phase 3 deliverable. Until the compiler
exposes a full AST dump, extraction reads `xz check-json` diagnostics plus the
doc comments parsed from source. The compiler does not yet emit the derived
effect profile (`xz check --verbose` does not exist), so the card carries
`derivedEffects` as a field the extraction fills once that surface exists. The
interface is designed so a richer compiler output can replace the parser
without changing the card model.

## 7. Card model (planned)

```ts
interface AuditCard {
  module: string;
  signature: string;
  intent: string;
  declaredEffects: EffectLabel[];
  derivedEffects: EffectLabel[];
  trustedClaims: { claim: string; note: string }[];
  diagnostics: Diagnostic[];   // the clearing run
  diff: string;                // unified diff vs last approved
  status: "pending" | "approved" | "rejected" | "blocked";
}
```

## 8. Non-goals

- The audit UI does not edit Xz code. Edits go back through the agent or the
  developer's editor.
- It does not replace `xz check --strict`; it surfaces what the compiler
  already decided.
