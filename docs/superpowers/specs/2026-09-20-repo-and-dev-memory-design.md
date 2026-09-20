---
type: spec
date: 2026-09-20
status: proposed
tags: [spec, tooling, dev-memory, obsidian]
related: ["[[2026-09-20-kestrel-ai-rename-design]]", "[[2026-09-17-kestrel-ai-app-design]]"]
---

# Kestrel AI: public repo, Obsidian dev memory, and the Monolith working agreement

## 1. Goal

Give this project the three things it lacks: a **git remote** so it can be worked on from any
machine, an **Obsidian dev-memory vault** so the project's reasoning survives between sessions,
and the **working agreement** that Monolith (`E:\Danijel Work\Monolith`) develops under.

Runs **after** [[2026-09-20-kestrel-ai-rename-design]], so the repo debuts under the new name and
the secret scan runs against the final tree.

## 2. Decisions taken

| Question | Decision |
| --- | --- |
| Remote | `Synapsekw/kestrel-ai`, **public** |
| `.superpowers/` SDD state | **Tracked** — it must travel between machines |
| Branching | **`main` + task worktrees**; no `develop`. Monolith's promotion flow exists to gate Vercel deploys; a desktop app has no equivalent, so a release is a tagged installer build |
| Scope of the port | All four pieces: `AGENTS.md`, `CONTRIBUTING.md`, the vault, and the scripts + `/wrapup` |
| Vault seeding | **Hybrid** (§4.3) |
| Vault display name | Left as `app` (folder is `E:\Dev\Yolo\app`); renaming the folder would break the venv, Tauri's `target/` and the Claude project dir, for cosmetics |

## 3. Repository and remote

### 3.1 Secret scan — blocking gate

The repo goes **public**, so before `git push` ever runs:

- Scan tracked files **and full history** (`git log -p`) for `sk-`, `gho_`, `ghp_`, `AKIA`,
  `-----BEGIN … PRIVATE KEY-----`, and `.env` content.
- Pay particular attention to `docs/evidence/**` (captured JSON and screenshots of a running app)
  and `.superpowers/sdd/**/review-*.diff` (raw diffs of everything reviewed).
- Confirm `.env*` was never committed.

Any hit **stops the publish** and is reported before anything is pushed. Nothing goes public
unscanned. If history is contaminated the fallback is a fresh-root publish, decided with the
owner rather than assumed.

### 3.2 Publish

- Set the missing `git config user.name` to `Danijel Jovanovic` (email `info@synapse-solutions.ai`
  is already set). Monolith pins commit identity; this repo has only half of it.
- `gh repo create Synapsekw/kestrel-ai --public --source . --remote origin`, description from
  `PRODUCT.md`.
- Push `main`, then `s6-packaging-acceptance`, `usability-wave1`, `wave1-s2-trial`.
- `main` gets branch protection off for now (single-operator repo); the gate is
  `finish-task.ps1`, not a review requirement.

### 3.3 `.gitignore`

Remove the `.superpowers/` line; add `.superpowers/**/node_modules/`. That tracks 38 files /
1.1 MB of wave ledgers, task briefs and review diffs. Everything else stays ignored: `.venv`,
`node_modules`, `*.pt`/`*.onnx`/`*.engine`, `dist/`, `.worktrees/`, `.env*`, build trees.

Also ignore `.playwright-mcp/` (currently untracked scratch output).

## 4. The Obsidian vault

### 4.1 Shape

Monolith's shape exactly: `.obsidian/` at the **repo root**, so the vault spans the whole repo and
indexes `docs/` alongside `vault/`.

```
kestrel-ai/
  .obsidian/              config + vendored plugins
  vault/
    00-north-star.md      where we are, where we're going   (homepage)
    product.md            from PRODUCT.md + DESIGN.md
    moc/                  architecture · roadmap · specs · operations · memory
    decisions/            ADRs and extracted gotchas, dated
    sessions/             one note per working block
    templates/            session.md · decision.md · moc.md
    _attachments/
```

### 4.2 Obsidian configuration

- Copy `.obsidian/` from Monolith: `dataview`, `templater-obsidian`, `homepage`, plus
  `app.json`, `appearance.json`, `core-plugins.json`, `community-plugins.json`, `templates.json`.
  Drop `workspace.json` (per-machine window layout — noise in git).
- **Vendor the plugin code** (~1.7 MB, mostly Dataview) rather than ignoring it. That is what
  makes a fresh clone on a second machine open with live queries instead of raw code blocks —
  the whole point of the remote.
- Point `homepage` at `vault/00-north-star.md` and Templater's template folder at
  `vault/templates`.
- Register the vault in `%APPDATA%\obsidian\obsidian.json` alongside the existing four, so it
  appears in the vault switcher. This edits an app config file outside the repo — the existing
  entries are preserved and the file is backed up first.

### 4.3 Seeding — hybrid

`docs/progress.md` already holds real memory (317 lines). The split:

**Converted into the vault:**

- `00-north-star.md` — absorbs "Current state", the Phase 2 usability table and "Plans"; becomes
  the single entry point.
- `product.md` — from `PRODUCT.md` (purpose, users, success criteria, tone, anti-references) with
  the `DESIGN.md` "Site office" system as design context.
- `vault/decisions/` — one ADR per entry in **"Decisions the spec does not cover"** (~10), plus:
  - the shared-venv deletion incident (2026-09-18) as a `gotcha`,
  - the two rules currently only in Claude's user-level memory: heredoc backslash collapse, and
    worktree-junction removal without losing the venv,
  - the rename ADR required by [[2026-09-20-kestrel-ai-rename-design]] §5.
- `vault/moc/` — five thin index notes. `operations.md` links out to `docs/progress.md` and
  `scripts/acceptance.md`.
- `vault/sessions/` — one seed note for today's session; history is **not** back-filled.

**Left where it is:** the checkpoint tables, acceptance runs and S6 packaging evidence in
`docs/progress.md`. They already read well as the ledger they are. `docs/progress.md` gains
frontmatter (`type: report`) so Dataview indexes it, and is linked from `moc/operations`.

Rule imported from Monolith: **frontmatter-or-die** — every note opens with YAML carrying at
least a `type` (`session | adr | moc | north-star | product-context | report | spec`).

## 5. `AGENTS.md` and `CONTRIBUTING.md`

`CLAUDE.md` contains exactly `@AGENTS.md`, as in Monolith.

`AGENTS.md` carries the orientation map (`backend/`, `frontend/`, `contract/`, `docs/`, `vault/`),
the engineering invariants, and the working agreement below — Monolith's six rules, re-pointed at
this stack.

1. **`main` + task worktrees.** The main checkout is the integration home; you do not build in it.
   Each building session gets a worktree at `.claude/worktrees/<name>` on a `task/<name>` branch
   (nested inside the project on purpose, so dispatched subagents can write into it). Commit
   identity is pinned. **Stage by path — never `git add -A`.** A task is not done until the gates
   pass, it is merged to `main`, the worktree is removed and the branch deleted, and the owner has
   a numbered "how to test this" walkthrough (or one line saying the change is not user-observable).
   Trivial edits are exempt and may go straight on `main`.
2. **Superpowers skills for non-trivial work** — `brainstorming` before building,
   `test-driven-development`, `verification-before-completion`, `systematic-debugging`,
   `subagent-driven-development`. A one-line fix is just a one-line fix.
3. **UI work loads the design skills first**, together with `DESIGN.md` (the "Site office" system)
   and the primitives in `frontend/src/ui/`. Already machine-enforced by
   `frontend/scripts/check-tokens.mjs`.
4. **Tests are mandatory** — written and executed. The gate:
   ```
   pnpm -C contract check
   cd backend && ruff check . && pytest
   pnpm -C frontend lint
   pnpm -C frontend test
   pnpm -C frontend build
   ```
   Packaging changes additionally require the freeze, the frozen smoke and the installer build.
5. **Contract-first.** `contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts`
   is generated and committed in the same change, never hand-edited. (This is the local analogue of
   Monolith's migrations-and-regenerate-types rule — stale generated types are the main source of
   `any` creep.)
6. **Every spec and plan states a budget and an execution DAG.**
   - *Budget, this app's version:* long work (training, inference, import, export) is a
     **background job with progress**, never blocking the UI; dataset reads are **bounded** —
     no loading a full image set into memory; GPU work states its expected duration.
   - *DAG:* plans name independent units, group them into parallel batches, and identify the
     critical path. A flat sequential task list is not ready to build. The wave/ledger structure
     already in `.superpowers/sdd/` is this rule in practice.

`CONTRIBUTING.md` is the long-form reference: prerequisites and setup (from `README.md`), the
script table, the branching workflow, commit hygiene, Conventional Commits, testing gates, the
packaging path, and the dev-memory rules.

## 6. Scripts and `/wrapup`

PowerShell, not Monolith's bash.

**`scripts/start-task.ps1 <name>`** — fetch `origin/main`; create worktree `.claude/worktrees/<name>`
on `task/<name>`; pin commit identity; `uv sync` in the worktree backend and `pnpm install` in
`frontend/` and `contract/`; print the `cd` line. The install is required, not optional: without it
the bare `vitest`/`tsc`/`eslint` in `package.json` scripts resolve no binary.

**`scripts/finish-task.ps1`** — run from inside the worktree. Rebase onto latest `main` so the
gates run against the merged state, run the §5.4 gate, merge to `main`, push, then remove the
worktree and delete the branch. Removal **deletes junctions as links** (via .NET), never
`rm -rf` — the rule that cost a shared venv on 2026-09-18. Aborts cleanly on a rebase conflict.

**`.claude/commands/wrapup.md`** — writes `vault/sessions/YYYY-MM-DD-HHmm-<slug>.md` from the
session template (what changed, why, open threads, next entry point, how to test) and bumps
`vault/00-north-star.md` plus its `last-updated` frontmatter.

`.gitignore` gains `.claude/worktrees/`.

## 7. Verification

1. `gh repo view Synapsekw/kestrel-ai` resolves; all four branches present.
2. A fresh `git clone` into a scratch directory contains `vault/`, `.obsidian/`, `docs/` and
   `.superpowers/sdd/` — the second-machine test, done for real, not assumed.
3. Obsidian opens the vault from the switcher; `00-north-star.md` is the homepage; the Dataview
   blocks in `moc/memory.md` render as tables, not code blocks.
4. Every vault note has `type` frontmatter.
5. One throwaway round trip: `start-task.ps1 rename-check` → trivial edit → `finish-task.ps1`
   completes green, worktree gone, branch deleted, `main` advanced.
6. The secret scan of §3.1 reported clean **before** the first push.

## 8. Out of scope

Renaming the project folder `E:\Dev\Yolo\app`; CI changes beyond the rename's one path fix;
back-filling session notes for the 2026-09-17 → 2026-09-19 history (the checkpoint ledger in
`docs/progress.md` already covers it).
