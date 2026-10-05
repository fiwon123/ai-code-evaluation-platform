## Memory Protocol

Six local memory slots: three **global** (project lifetime) and three
**short-term** (one task). The slots live in `.opencode/memory/` and are
gitignored — run notes and task state are per-checkout and must never reach a
PR. **This file is tracked**; the contents are not.

```
.opencode/memory/
├── global-1-architecture.md      project   stack, layering, footguns
├── global-2-conventions.md       project   branch/commit/PR/test/secret rules
├── global-3-milestone-state.md   per milestone   what the current milestone is for
├── short-term-1-task.md          per task   goal, THE PLAN, files, done criteria
├── short-term-2-github-state.md  per task   issue, branch, PR, comments, cleanup
└── short-term-3-verification.md  per task   commands run, results, unverified
```

### When to read

| When | Read |
|------|------|
| Session start, before planning | all three `global-*` |
| Before the first edit of a task | `short-term-1-task.md` |
| Before any git/GitHub action | `short-term-2-github-state.md` |
| Before claiming anything passed | `short-term-3-verification.md` |

Globals are written once and corrected when reality contradicts them. Short-terms
are cleared when a task ends.

### When to write

- **A global** changes when the architecture or a convention changes — and then
  only after confirming it in the code or `AGENTS.md`, not from memory.
- **`short-term-1`** the moment the goal is known, and the moment a plan exists.
- **`short-term-2`** at every workflow milestone: issue created, PR opened,
  merged, released.
- **`short-term-3`** after **every** command whose result you intend to report.

### The memory is not the source of truth

`AGENTS.md`, `PROJECT_CONTEXT.md`, `opencode.json` and the code win. Memory is a
cache. If they disagree, the tracked file is right — correct the memory in the
same task, do not defer it.

Never record a credential, a `.env` value, or a token in any slot.

## Plan before build

**`build` must not edit a file before `short-term-1-task.md` has a filled-in
Plan section.** If it is empty, or you are unsure about any part of the
requirement, call the `plan` agent first, write the plan down, then implement.

`plan` is read-only (`edit: deny`; bash limited to `git log`, `git diff`, `ls`),
so asking it for a plan adds no capability `build` lacks. It is the cheapest way
to avoid a confident guess and a rework loop.

Plan-first is not ceremony. In this repo the documented test commands failed for
two different reasons that no amount of care would have predicted — `uv` absent,
and Redis down making submissions return 503 — while a previous session's notes
claimed the gate was green. Deriving the procedure first is what caught both.

## Handoff contract

```
        ┌──────────── user switches mode ────────────┐
        │                                              │
     plan  ──(hands back a written plan)──►  build  ◄──(asks for a plan)──  build
      ▲                                          │
      │                                          │
      └────────(asks for review/clarity)──────────┘
                 visual  ◄──(frames, findings)──►  build / plan
```

### `build → plan`: spawn, allowed

`build` may spawn `plan`. `plan` is strictly less capable (`edit: deny`), so this
is delegation downward, not escalation.

### `plan → build`: mode switch, **never** a spawn

`plan` finishes by presenting the plan and handing back. The **user** switches to
`build`. `plan` must not spawn `build`.

This is the security-relevant rule. `build` has `edit: allow` and `make *`, so a
`plan` that could spawn it would be able to modify the repo through a subagent —
defeating `edit: deny` by a route `opencode.json` cannot police.
`backend/tests/test_opencode_env_guard.py` asserts the effective bash/read denies
for every agent; it does not model delegation, so this boundary is kept in prose
and enforced by `plan.md`'s instructions.

### `visual`: read-only either way

`visual` may be spawned by `build` or `plan` for screenshot, contact-sheet and
frame inspection (`edit: deny`, bash limited to `ls`). It returns findings; it
never edits. `visual` hands back to whichever agent asked.

## Rotation

When a task closes: reset the three `short-term-*` files to their templates, and
if the milestone moved, rewrite `global-3-milestone-state.md` from
`gh api repos/:owner/:repo/milestones`. Keep the three `global-*` files unless
the underlying fact changed.