# 02 — Agent self-correction loop

`next.xz/agent` drives an LLM to write `.xz` code and repairs compiler errors
without human intervention, within a bounded budget.

## 1. Why the loop works

Xz's compiler is designed for this loop:

- `xz check-json` emits a JSON array of diagnostics.
- Each diagnostic carries a stable `code`, a machine-readable `span`, a
  `category`, and (for intent diagnostics) a `suggestion.fix` with a
  `confidence`.
- Codes are never renumbered or reused, so a fix mapping learned for one error
  stays valid.

Diagnostic schema:

```json
{
  "version": 1,
  "severity": "error",
  "code": "I0020",
  "message": "declared @effects 'none' does not match derived effects 'io' on 'f'",
  "category": "intent",
  "span": { "file": "src/main.xz", "start": [4, 6], "end": [4, 7] },
  "suggestion": { "fix": "extend @effects on 'f' to include 'io'", "confidence": 0.9 }
}
```

## 2. The loop

```
┌──────────────┐
│ intent spec  │  natural language + optional contract shell
└──────┬───────┘
       ▼
┌──────────────┐
│ prompt build │  system rules + spec + (on retry) prior diagnostics
└──────┬───────┘
       ▼
┌──────────────┐
│    LLM       │  writes candidate.xz
└──────┬───────┘
       ▼
┌──────────────┐     errors     ┌──────────────────────────┐
│ xz check-json│ ─────────────► │ rank + filter diagnostics│
└──────┬───────┘                └───────────┬──────────────┘
       │ zero errors                        │
       ▼                                    ▼
┌──────────────┐                    ┌──────────────┐
│  hand off to │                    │ repair prompt│──┐
│  audit UI    │                    └──────────────┘  │
└──────────────┘                           ▲          │
                                           └──────────┘
                                        retry while attempts < N
```

## 3. Retry policy

- `N` defaults to **3**. Configurable per call site.
- On each retry, inject only the diagnostics from the latest run — not the full
  history — plus a one-line summary of what changed.
- When `attempts == N` and errors remain, stop and emit `escalated` with the
  final diagnostics and the candidate source. Never commit a failing module.

## 4. Diagnostic ranking and filtering

P0: inject all errors, ordered by:

1. `severity` (error before warning),
2. `category` (parse → resolve → type → intent; earlier phases unblock later
   ones),
3. `suggestion.confidence` (highest first).

P1: filter by AST line range. When the agent is editing one function, inject
only diagnostics whose `span` intersects that function's range, plus any
project-wide errors that are prerequisites. This keeps the context small as
files grow.

## 5. Prompt contract

The system prompt states the invariants the agent must preserve:

- Public `func`/`task` (except `main`) require an intent comment (`I0022`).
- Every claim must be paired with a formal `pre`/`post` (`I0021`).
- `@effects` must match the derived profile (`I0020`); allowed labels are
  `none`, `mut`, `io`, `chan`, `extern` (`I0024`).
- An unprovable claim needs `@trusted` with a review note, and only in
  `--strict` (`I0001`, `I0004`).
- `Result` types on the single error channel; no exceptions.

The agent is told it may only edit `.xz` and `.xzint` files unless a developer
flag widens the scope.

## 6. Safety rails

| Rail | Behavior |
|---|---|
| File scope | Writes limited to `.xz`/`.xzint` by default. Editing `app/**/page.tsx`, `route.ts`, middleware, or config requires an explicit flag. |
| Retry budget | Hard stop at N; escalation, never silent acceptance. |
| Strict mode | Optional `xz check --strict` so unproven, untrusted claims block. |
| No auto-commit | The agent never commits; approval is a human action in the audit UI. |
| Audit trail | Every attempt (prompt hash, source, diagnostics) is recorded for review. |

## 7. Library surface (planned)

```ts
import { runAgent } from "@xz-lang/agent";

const result = await runAgent({
  intent: "Compute the payable total for an order.",
  target: "src/logic/order.xz",
  shell: contractShell,        // optional @intent/@effects scaffold
  retries: 3,
  strict: true,
  model,                       // Vercel AI SDK / LangGraph model
});

// result.status: "passed" | "escalated"
// result.source: the final .xz text
// result.attempts: number
// result.diagnostics: Diagnostic[]
```

The orchestrator is model-agnostic: it wraps the Vercel AI SDK or LangGraph,
and only depends on a `generate(prompt) -> text` interface.

## 8. Metrics

The loop reports the KPIs from the PRD: first-pass rate, self-correction rate,
and escalation rate. These are recorded per run so a regression in prompt
quality is visible.
