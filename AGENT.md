# AGENT.md — Working agreements for this repository

`next.xz` is in the **design/documentation phase**: the product of this repo is
the PRD, the architecture, and the subsystem specs. There is no implementation
yet. Everything an AI assistant does here must make the AI-written backend
*more reviewable* — that is the whole point of the project.

## Repo layout

- `prd.md` — authoritative scope. If a requirement is not here, it is not
  committed work.
- `ARCHITECTURE.md` — component contracts, type mapping, trust boundaries.
- `docs/01..05` — per-subsystem specs (bridge, agent loop, audit UI, NFRs,
  roadmap). Each spec owns its subsystem's details; the PRD owns priorities.
- The Xz language itself lives in the
  [Xz repository](https://github.com/x1zzdev/Xz). Do not duplicate its
  specification here; link to it.

## Ground rules

1. **Reviewability gate.** Every change must strengthen the answer to the four
   reviewer questions: *What does it do? What can it change? What are its
   guarantees? What can go wrong?* If a proposed feature makes any of them
   harder, reject it.
2. **Docs are the contract.** A new capability goes into the PRD (priority) and
   the relevant subsystem spec (design) first. If an example needs a behavior
   the specs do not define, add the spec before the example — never invent
   behavior silently.
3. **Stay true to the Xz surface.** Effect labels are `none`/`mut`/`io`/`chan`/
   `extern`. Only `@export` functions cross the ABI. `Result` is not
   C-representable. Check the Xz spec before asserting a compiler behavior.
4. **No silent degradation.** Never specify a lossy fallback; a value that
   cannot cross the boundary is a hard error.
5. **One canonical way.** Never introduce a second way to say something. Prefer
   the most explicit, most reviewable form and document it.

## Commit rule

**Commit continuously and autonomously, in the smallest coherent unit, as soon
as one completes. Do not wait for the user to ask.**

- One logical change = one commit. A spec gap, a doc fix, and a roadmap update
  are three commits, not one.
- "Smallest coherent unit" means the change is internally consistent and
  complete: links resolve, no stale cross-references, no half-edits.
- Commit messages state the decision, not the file list:
  `Pin the bridge to the compiler version`, not `Update docs`.
- Never bundle unrelated edits, and never commit secrets.

## Before committing

- Run `git status`, `git diff`, and `git log --oneline -10`; stage only the
  intended files.
- Verify consistency: no dangling links, no stale examples, no contradictions
  between the PRD, architecture, and subsystem specs.

## Language and style

- Docs are in English, written for a reviewer of AI-written code.
- No emojis. No comments in code that restate the code.
- Keep doc changes tight: a new rule is one section, one example, one rationale
  — not an essay.
- The user writes in Korean; respond in Korean unless the user switches.
