# 05 — Roadmap

```
2026 Q4                   2027 Q1                   2027 Q2                   2027 Q3
  │                         │                         │                         │
  ├─ Phase 1: PoC & Bridge  ├─ Phase 2: Agent Loop    ├─ Phase 3: Audit UI     └─ Phase 4: Production
```

## Phase 1 — Core bridge and PoC (Q4 2026)

Goal: prove the call path works end to end and is fast enough.

- [x] Validate C ABI shared-library compilation (`xz build --shared`). *(Done in
  Xz: `@export`, `@cstruct`, generated header.)*
- [ ] Implement Node.js/Bun FFI bindings for Next.js Server Actions.
  - Bun loader over `bun:ffi`.
  - Node loader over `koffi` (addon path deferred).
  - Version pinning and symbol checks.
- [ ] Implement the TypeScript binding generator over `.xzint` (fallback until
  `xz pkg gen --lang ts` ships).
- [ ] Create a benchmark suite comparing native TS logic vs. Xz FFI execution
  speed and latency.

Exit criteria: a Server Action calls an Xz `@export` function through the
generated binding, with measured overhead under 0.5 ms.

## Phase 2 — Agent and self-correction engine (Q1 2027)

Goal: an LLM writes `.xz` code that passes `xz check-json` without human help.

- [ ] Build `@xz-lang/agent` for the Vercel AI SDK / LangGraph.
- [ ] Integrate the `xz check-json` diagnostic parser into the LLM context loop.
- [ ] Establish the automated N-step retry and self-healing mechanism.
- [ ] Add diagnostic ranking; P1 adds span-based filtering.
- [ ] Instrument the KPIs: first-pass rate, self-correction rate, escalation
  rate.

Exit criteria: ≥ 60% first-pass and ≥ 85% self-correction on the benchmark
intent set.

## Phase 3 — Audit dashboard and developer experience (Q2 2027)

Goal: a human approves a module in under 10 seconds.

- [ ] Release the `@xz-lang/audit` React component package for the Next.js dev
  server (`/___audit`).
- [ ] Build the AST-based side-effect extraction tool for audit badges.
- [ ] Implement the `npx next.xz dev` unified CLI wrapper.
- [ ] P1: one-click approval triggering `xz build --shared` and a git commit.

Exit criteria: a reviewer approves a representative module in under 10 seconds
with badges alone.

## Phase 4 — Production hardening and ecosystem integration (Q3 2027)

Goal: production-ready across runtimes.

- [ ] Add a WebAssembly compilation target for Vercel Edge Runtime.
- [ ] Publish the official TypeScript type-generator plugin
  (`xz pkg gen --lang ts`).
- [ ] Harden the error-channel mapping (Result → typed exception) with a
  generated shim.
- [ ] Release v1.0.0 stable with comprehensive documentation.

Exit criteria: zero unhandled runtime crashes for approved modules in a
production pilot.

## Guiding constraint for every phase

Every feature must make it easier for a human to answer:

*What does it do? What can it change? What are its guarantees? What can go
wrong?*

If a feature makes any of those harder, it is rejected.
