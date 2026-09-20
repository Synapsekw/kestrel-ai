# Kestrel AI: Public Repo + Obsidian Dev Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give this project a public GitHub remote so it can be worked on from any machine, an Obsidian dev-memory vault modelled on Monolith's, and Monolith's working agreement adapted to this stack.

**Architecture:** Three independent layers, none of which changes application behaviour. A git layer (track the SDD state, scan for secrets, publish). A memory layer (`.obsidian/` at the repo root so the vault spans the whole repo, `vault/` for the memory notes). A process layer (`AGENTS.md`, `CONTRIBUTING.md`, worktree scripts, `/wrapup`). Publishing is last, so the repo debuts complete and the secret scan runs against the final tree.

**Tech Stack:** git + GitHub CLI (`gh`, authenticated as **Synapsekw**) · Obsidian (installed at `C:\Program Files\Obsidian`, vault registry at `%APPDATA%\obsidian\obsidian.json`) with the Dataview, Templater and Homepage community plugins · Windows PowerShell 5.1 for the scripts

**Spec:** `docs/superpowers/specs/2026-09-20-repo-and-dev-memory-design.md`

**Reference implementation:** `E:\Danijel Work\Monolith` — read its `AGENTS.md`, `CONTRIBUTING.md`, `vault/README.md`, `vault/00-north-star.md`, `vault/moc/memory.md` and `vault/templates/*` before writing the equivalents here. Copy its *shape*, not its content: Monolith is a Next.js/Supabase web app, this is a Tauri/FastAPI/YOLO desktop app.

## Global Constraints

- **The repo will be PUBLIC.** Nothing is pushed until Task 2's secret scan passes. If Task 2 finds anything, STOP and report — do not clean it up unilaterally, and do not push.
- **Publishing is a stop-and-ask.** Task 11 creates a world-readable repo. It requires explicit operator approval at the moment of running, even though the spec approves the intent. Never run it as part of an unattended batch.
- **Exact names:** repo `Synapsekw/kestrel-ai`, public. Product name **Kestrel AI** throughout, slug `kestrel-ai`.
- **Commit identity** is `Danijel Jovanovic <info@synapse-solutions.ai>` (already set locally). **Stage by path** — never `git add -A` / `git add .`.
- **Frontmatter-or-die:** every file under `vault/` opens with a YAML block at line 1 carrying at least a `type`, one of `session | adr | moc | north-star | product-context | report`.
- **Do not rewrite frozen history:** `docs/evidence/**`, the dated checkpoint / acceptance / S6-packaging rows of `docs/progress.md`, and the historical `docs/superpowers/plans/2026-09-1*.md` build plans.
- **Do not touch application code.** This plan adds documentation, configuration and scripts only. `backend/`, `frontend/src/`, `frontend/src-tauri/src/` and `contract/` are out of scope entirely.
- **The word "machinery"** still legitimately appears as the domain noun (the construction machinery the model detects). Never sweep it.
- Backend commands, if ever needed, use `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`. `cargo` is not on PATH; use `C:\Users\D\.cargo\bin\cargo.exe`.

## Execution DAG

- Task 2 depends on Task 1 (it must scan the newly-tracked `.superpowers/sdd/` too).
- Tasks 6 and 7 depend on Task 5 (the vault directories and templates must exist).
- Task 9 depends on Tasks 5 and 8 (it uses the session template and references the scripts).
- Task 10 depends on Tasks 5, 6, 7.
- Task 11 depends on Task 2 (scan clean) and on Tasks 1, 3, 4, 5, 6, 7, 8, 9 (the repo debuts complete).
- Task 12 depends on Task 11.

**Parallel batches:**
- **Batch A:** Tasks 1, 3, 4, 5, 8 — no shared files.
- **Batch B:** Task 2 (after 1), Tasks 6, 7 (after 5), Task 9 (after 5 and 8).
- **Batch C:** Task 10.
- **Batch D:** Task 11 → Task 12, strictly sequential, operator-gated.

**Critical path:** 1 → 2 → 11 → 12. Everything else is slack.

---

### Task 1: Track the SDD wave state

**Files:**
- Modify: `.gitignore`
- Add to git: `.superpowers/sdd/**`

**Interfaces:**
- Consumes: nothing.
- Produces: `.superpowers/sdd/` tracked in git, so Task 2 scans it and a second machine gets the wave ledgers.

- [ ] **Step 1: Edit `.gitignore`**

Remove the line `.superpowers/` and add in its place:

```
# SDD wave state travels with the repo; only its installs do not
.superpowers/**/node_modules/
```

In the same file, add under "worktrees and local data" (the working agreement in Task 3 puts task worktrees there):

```
.claude/worktrees/
```

and add, so scratch output from the Playwright MCP server stays local:

```
.playwright-mcp/
```

- [ ] **Step 2: Check what this will track**

Run:

```bash
git add -n .superpowers/sdd 2>&1 | head -50
git status --short .superpowers | wc -l
```

Expect roughly 40-60 files: wave ledgers, task briefs, reports and `review-*.diff` files across `2026-09-17-s0-contract-and-scaffolding/`, `wave1/`, `wave2/`, `wave3/`, `usability/` and `2026-09-20-kestrel-ai-rename/`.

If the count is in the thousands, a `node_modules` slipped through — fix the ignore rule before continuing.

- [ ] **Step 3: Commit**

```bash
git add .gitignore .superpowers/sdd
git commit -m "chore: track the SDD wave state so it travels between machines"
```

---

### Task 2: Secret scan — BLOCKING GATE

Nothing is published until this passes. The repo is going public and the history contains captured app output, screenshots and raw review diffs.

**Files:** none modified. This task produces a report, not a change.

**Interfaces:**
- Consumes: Task 1 (so `.superpowers/sdd/` is in the scanned set).
- Produces: a clean bill of health that Task 11 depends on.

- [ ] **Step 1: Scan every tracked file**

```bash
git ls-files -z | xargs -0 grep -n -I -E "sk-[A-Za-z0-9_-]{16,}|sk-ant-|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[baprs]-" 2>/dev/null
```

Expect **no output**, with one known-safe exception: `backend/tests/test_keys_config.py` defines `SECRET = "sk-test-do-not-log-4f8c2a"`, a deliberate fake used to assert keys never leak. That one is fine.

- [ ] **Step 2: Scan the full history**

```bash
git log -p --all | grep -n -E "sk-ant-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{32,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----" | head -40
```

Expect no output beyond the test fixture above.

- [ ] **Step 3: Confirm no env file was ever committed**

```bash
git log --all --diff-filter=A --name-only --format="%H" | grep -E "^\.env|/\.env" | sort -u
```

Expect no output.

- [ ] **Step 4: Check the evidence and diff payloads specifically**

These are the highest-risk paths: captured JSON from a running app, screenshots, and raw diffs of everything ever reviewed.

```bash
git ls-files -z 'docs/evidence/*' '.superpowers/sdd/*' | xargs -0 grep -l -I -E "api[_-]?key|authorization|bearer |token" 2>/dev/null
```

For each file listed, open it and confirm the hit is a *field name, header name or placeholder* and not a live value. Record each one in the report with its verdict.

Also note that `docs/evidence/` contains screenshots of the app. Look at any that might show a settings screen with a key visible:

```bash
git ls-files 'docs/evidence/**/*.png' | head -40
```

- [ ] **Step 5: Write the verdict**

Write `docs/evidence/2026-09-20-secret-scan.md` with: each command run, its output, the adjudication of every hit, and a final CLEAN / NOT CLEAN verdict.

**If NOT CLEAN: stop the plan here and report to the operator.** Do not rewrite history, do not scrub files, do not push. The operator decides between scrubbing, a fresh-root publish, or keeping the repo private.

- [ ] **Step 6: Commit**

```bash
git add docs/evidence/2026-09-20-secret-scan.md
git commit -m "docs: secret scan before the repo goes public"
```

---

### Task 3: `CLAUDE.md` and `AGENTS.md`

**Files:**
- Create: `CLAUDE.md`, `AGENTS.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the working agreement that Task 4's `CONTRIBUTING.md` is the long-form reference for, and that Task 8's scripts implement.

- [ ] **Step 1: Create `CLAUDE.md`**

It contains exactly one line, as in Monolith:

```
@AGENTS.md
```

- [ ] **Step 2: Write `AGENTS.md`**

Read `E:\Danijel Work\Monolith\AGENTS.md` first for shape. Required sections, in order:

**`# Where things live`** — an orientation table. Rows, with what each holds:

| Path | What's there |
| --- | --- |
| `backend/` | FastAPI sidecar: projects, datasets, annotation storage, jobs, training, inference. Python 3.11 in `backend/.venv` (uv) |
| `frontend/` | Tauri 2 shell (`src-tauri/`, Rust) + the React/TS/Vite UI (`src/`) |
| `frontend/src/ui/` | The design-system primitives; `scripts/check-tokens.mjs` enforces their use |
| `contract/` | `openapi.yaml` (source of truth), the generated TS client, Prism mock, Spectral lint |
| `docs/` | `progress.md` (the evidence ledger), `superpowers/{specs,plans}`, `evidence/` |
| `vault/` | Dev memory: `00-north-star.md`, `decisions/` (ADRs), `sessions/` |
| `.superpowers/sdd/` | Per-plan SDD workspaces: ledgers, task briefs, review packages |

**`# Engineering invariants`** — the non-negotiables, each one sentence with its rationale:
- `contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts` is generated and committed in the same change, never hand-edited.
- API keys live only in Windows Credential Manager, never in a project folder, app-data file, log, error message or commit.
- Long work (training, inference, import, export) is a **background job with progress**, never blocking the UI.
- Hot-path reads are **bounded** — no loading a full image set into memory.
- The app must start even when startup work fails; a failed app-data migration logs and continues.
- Tauri's `capabilities/default.json` is a **runtime** allow-list. Changing a sidecar name there is not caught by any test — see `vault/decisions/`.

**`# Dev memory`** — one short paragraph: this repo keeps a tracked Obsidian vault at `vault/`. At the end of a working block run `/wrapup` to log a session note in `vault/sessions/` and bump `vault/00-north-star.md`. Record non-obvious traps as ADRs in `vault/decisions/`.

**`# Working agreement`** — the six numbered rules. Use the wording from the spec's §5, which is already adapted to this stack:
1. `main` + task worktrees at `.claude/worktrees/<name>` on `task/<name>` branches; never build in the main checkout; stage by path; a task is not done until merged, worktree removed, branch deleted, and the operator has a numbered "how to test this" walkthrough (or one line saying the change is not user-observable). Trivial edits are exempt.
2. Superpowers skills for non-trivial work: `brainstorming` before building, `test-driven-development`, `verification-before-completion`, `systematic-debugging`, `subagent-driven-development`.
3. UI work loads the design skills first, plus `DESIGN.md` (the "Site office" system) and `frontend/src/ui/`.
4. Tests are mandatory, written and executed. Quote the six-command gate verbatim (see Task 4 Step 2).
5. Contract-first (the local analogue of Monolith's migrations rule).
6. Every spec and plan states a **budget** (what is a background job; what is bounded) and an **execution DAG** (independent units, parallel batches, critical path). A flat sequential task list is not ready to build.

Keep it under ~150 lines. `CONTRIBUTING.md` carries the detail.

- [ ] **Step 3: Verify the paths named in the file actually exist**

```bash
for p in backend frontend/src/ui contract docs/superpowers .superpowers/sdd DESIGN.md frontend/scripts/check-tokens.mjs; do [ -e "$p" ] && echo "ok   $p" || echo "MISSING $p"; done
```

Every line must say `ok`. (`vault/` will not exist until Task 5 — that is expected; it is the one forward reference.)

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md AGENTS.md
git commit -m "docs: add the working agreement (CLAUDE.md -> AGENTS.md)"
```

---

### Task 4: `CONTRIBUTING.md`

**Files:**
- Create: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: nothing.
- Produces: the long-form reference `AGENTS.md` points at.

- [ ] **Step 1: Write it**

Read `E:\Danijel Work\Monolith\CONTRIBUTING.md` for shape. Required sections:

`## Prerequisites` and `## Setup` — lift the facts from `README.md` (Windows 11, NVIDIA driver 591.86+, Node 24 + pnpm 10, uv 0.11+, Rust stable MSVC, ~20 GB free). Do not duplicate the whole README; link to it.

`## Scripts` — a table of the commands that matter: `backend\scripts\build.ps1`, `backend\scripts\smoke_frozen.ps1`, `pnpm -C frontend build:installer`, `pnpm -C contract check`, `pnpm -C contract mock`, `scripts/dev.ps1`, plus the two new ones from Task 8.

`## Branching workflow` — `main` is the integration home. Every non-trivial session: `scripts\start-task.ps1 <name>` → build in `.claude/worktrees/<name>` on `task/<name>` → `scripts\finish-task.ps1`. A release is a tagged installer build, not a branch promotion.

`## Commit hygiene` — stage explicitly by path; run `git status` first and confirm every staged path is yours; never `git add -A`, `git add .` or `git commit -a`. Sweep in unrelated changes only when explicitly asked.

`## Commit messages` — Conventional Commits (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`), imperative subject, body explaining *why*.

`## Testing` — the gate, verbatim:

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
cargo test --manifest-path frontend/src-tauri/Cargo.toml
```

Note that packaging changes additionally require `build.ps1`, `smoke_frozen.ps1` and `build:installer`, and that a worktree has no venv of its own — it uses the main checkout's interpreter.

`## Dev memory` — the vault rules: frontmatter-or-die, `/wrapup` at the end of a block, ADRs for non-obvious traps, the north-star bump rule.

- [ ] **Step 2: Commit**

```bash
git add CONTRIBUTING.md
git commit -m "docs: add the contributor reference"
```

---

### Task 5: Vault scaffold and Obsidian configuration

**Files:**
- Create: `.obsidian/` (copied from Monolith, minus `workspace.json`), `vault/templates/{session,decision,moc}.md`, `vault/_attachments/.gitkeep`, `vault/README.md`
- Create empty dirs with `.gitkeep`: `vault/sessions/`, `vault/decisions/`, `vault/moc/`

**Interfaces:**
- Consumes: nothing.
- Produces: `vault/templates/session.md` and `vault/templates/decision.md`, used by Tasks 7 and 9; the `.obsidian/` config Task 10 verifies.

- [ ] **Step 1: Copy the Obsidian configuration from Monolith**

```bash
mkdir -p .obsidian
cp -r "/e/Danijel Work/Monolith/.obsidian/app.json" "/e/Danijel Work/Monolith/.obsidian/appearance.json" "/e/Danijel Work/Monolith/.obsidian/core-plugins.json" "/e/Danijel Work/Monolith/.obsidian/community-plugins.json" "/e/Danijel Work/Monolith/.obsidian/templates.json" .obsidian/
cp -r "/e/Danijel Work/Monolith/.obsidian/plugins" .obsidian/plugins
```

Do **not** copy `workspace.json` (per-machine window layout) or `graph.json`. Vendoring the plugin code (~1.7 MB, mostly Dataview) is deliberate: it is what makes a fresh clone on another machine open with live queries instead of raw code blocks.

- [ ] **Step 2: Point the plugins at this vault's paths**

In `.obsidian/templates.json`, set the template folder to `vault/templates`.
In `.obsidian/plugins/homepage/data.json`, set the homepage to `vault/00-north-star`.
Read each file first — do not invent keys; keep whatever other settings Monolith had.

- [ ] **Step 3: Create the three templates**

Copy them verbatim from Monolith — they are already correct and use Templater syntax:

```bash
mkdir -p vault/templates vault/sessions vault/decisions vault/moc vault/_attachments
cp "/e/Danijel Work/Monolith/vault/templates/session.md" "/e/Danijel Work/Monolith/vault/templates/decision.md" "/e/Danijel Work/Monolith/vault/templates/moc.md" vault/templates/
touch vault/sessions/.gitkeep vault/decisions/.gitkeep vault/moc/.gitkeep vault/_attachments/.gitkeep
```

Then edit `vault/templates/session.md` so its "How to test" section exists — the working agreement requires every session note to carry one. Add after "## Open threads":

```markdown
## How to test

- (numbered steps for the operator: where to go, what to click, expected result — or one line
  saying the change is not user-observable)
```

- [ ] **Step 4: Write `vault/README.md`**

Model it on `E:\Danijel Work\Monolith\vault\README.md`. It must state: the vault spans the **whole repo** (`.obsidian/` at the repo root), so `docs/` is indexed alongside `vault/`; the entry point is `[[00-north-star]]`; the layout; the four maintenance rules (north-star bump, capture a session per working block, record gotchas as ADRs, frontmatter-or-die); and that Dataview + Templater are required and vendored in `.obsidian/plugins/`.

Add a "Related" line noting the machine-local auto-memory at `C:\Users\D\.claude\projects\E--Dev-Yolo-app\memory\` is a *different* layer that coexists: that one is user behaviour, this one is project state.

- [ ] **Step 5: Commit**

```bash
git add .obsidian vault
git commit -m "feat(vault): scaffold the Obsidian dev-memory vault"
```

---

### Task 6: North star and product context

**Files:**
- Create: `vault/00-north-star.md`, `vault/product.md`, `vault/moc/{architecture,roadmap,specs,operations,memory}.md`
- Modify: `docs/progress.md` (frontmatter only)

**Interfaces:**
- Consumes: Task 5 (directories and templates).
- Produces: `[[00-north-star]]`, the homepage Task 10 verifies.

- [ ] **Step 1: Write `vault/00-north-star.md`**

Frontmatter: `type: north-star`, `status: active`, `last-updated: 2026-09-20`, `tags: [project/kestrel-ai, north-star]`.

Sections, sourced from the existing repo — read them, do not invent:
1. **Pitch** — from `PRODUCT.md` and `README.md`: a Windows desktop app for aerial construction-machinery detection; dataset preparation, bounding-box annotation, YOLO training with a model registry, and inference with local models or OpenAI/Anthropic vision models. Name the stack and link the master spec `[[2026-09-17-kestrel-ai-app-design]]`.
2. **Where we are** — absorb the "Current state" section of `docs/progress.md`, including the 2026-09-20 rename to Kestrel AI.
3. **Phases** — absorb the "Phase 2: usability" table and "Plans" section of `docs/progress.md`, status plus a one-line outcome each.
4. **Now** — the live state: what shipped last, what is in flight, what is next.
5. **Owed** — the outstanding items. At minimum: **the acceptance run is stale** — `docs/progress.md` records 8/8 PASS measured on the pre-rename build at `9f3aa01`; it must be re-run against the renamed installed build (plan `2026-09-20-kestrel-ai-rename.md` Task 11 Step 5).

- [ ] **Step 2: Write `vault/product.md`**

Frontmatter `type: product-context`. Source: `PRODUCT.md` (purpose, users, success criteria, tone, anti-references, strategic principles) and `DESIGN.md` for the "Site office" design language. Link `[[00-north-star]]`.

- [ ] **Step 3: Write the five MOCs**

Each is a thin index with `type: moc` frontmatter, a one-line purpose, and links out. Not prose essays.

- `architecture.md` — backend / frontend shell / UI / contract, and where each lives.
- `roadmap.md` — links to `[[00-north-star]]` phases and the plans in `docs/superpowers/plans/`.
- `specs.md` — a Dataview listing of `docs/superpowers/specs`:
  ````
  ```dataview
  TABLE status, date
  FROM "docs/superpowers/specs"
  SORT date DESC
  ```
  ````
- `operations.md` — build, freeze, installer, acceptance. Links out to `docs/progress.md` (the evidence ledger) and `scripts/acceptance.md`. State plainly that the checkpoint and acceptance tables stay in `progress.md` and are *not* duplicated here.
- `memory.md` — the self-referential map, modelled on Monolith's: layer 1 is this vault (project state), layer 2 is `.superpowers/sdd/` (per-plan SDD workspaces), layer 3 is the machine-local Claude auto-memory at `C:\Users\D\.claude\projects\E--Dev-Yolo-app\memory\` (user behaviour, outside the repo). Include a Dataview block listing gotcha ADRs:
  ````
  ```dataview
  TABLE status, file.cday as "Recorded"
  FROM "vault/decisions"
  WHERE contains(tags, "gotcha")
  SORT file.cday DESC
  ```
  ````

- [ ] **Step 4: Give `docs/progress.md` frontmatter so Dataview indexes it**

Insert at line 1, above the `# Progress log` heading:

```markdown
---
type: report
status: active
tags: [operations, evidence]
---
```

Change nothing else in that file.

- [ ] **Step 5: Commit**

```bash
git add vault/00-north-star.md vault/product.md vault/moc docs/progress.md
git commit -m "feat(vault): north star, product context and the maps of content"
```

---

### Task 7: Seed the decision log

**Files:**
- Create: ~13 files under `vault/decisions/`

**Interfaces:**
- Consumes: Task 5 (`vault/templates/decision.md`).
- Produces: the ADR set `vault/moc/memory.md`'s Dataview query lists.

Every file uses the `vault/templates/decision.md` structure (Context / Decision / Rationale / Consequences / Related) with frontmatter `type: adr`, a `date`, `status: accepted`, and `tags: [decision]` or `tags: [decision, gotcha]`.

Filenames are `YYYY-MM-DD-<slug>.md` using the date the decision was actually made, not today's.

- [ ] **Step 1: Convert the spec-gap decisions**

Source: `docs/progress.md` → "Decisions the spec does not cover (question, chosen default)", items 1-13. Read that section; each numbered item becomes one ADR, dated `2026-09-17` (items 1-9, 11-12) or `2026-09-18` (items 10, 13 — they are Wave 1 / packaging decisions).

Suggested slugs, one per item:
1. `2026-09-17-shared-infrastructure-lives-in-s0`
2. `2026-09-17-jobs-are-per-project`
3. `2026-09-17-websocket-token-as-query-param`
4. `2026-09-17-prism-mock-and-openapi-typescript`
5. `2026-09-17-port-allocation`
6. `2026-09-17-endpoints-beyond-the-literal-spec`
7. `2026-09-17-s0-sidecar-excludes-torch`
8. `2026-09-17-uv-and-pinned-ml-stack`
9. `2026-09-17-tauri-identifier-and-product-name`
10. `2026-09-18-wave1-contract-additions`
11. `2026-09-17-onnx-export-dependencies`
12. `2026-09-18-health-reports-gpu`
13. `2026-09-18-gotcha-inno-setup-because-nsis-and-msi-cap-at-2gb` — tag this one `gotcha`; it is the most valuable single note in the set.

Keep each ADR short: the question, the chosen default, and *why*. Do not pad. Item 9's Decision must record the current value `ai.synapse-solutions.kestrel-ai` / "Kestrel AI" and note in Consequences that it was renamed on 2026-09-20 — link `[[2026-09-20-decision-rename-to-kestrel-ai]]`.

- [ ] **Step 2: Convert the incident**

Source: `docs/progress.md` → "Incident: shared venv deleted with the S6 worktree (2026-09-18, recovered)".

File: `2026-09-18-gotcha-shared-venv-deleted-with-a-worktree.md`, tags `[decision, gotcha]`.

Its **Decision** section must carry the operational rule, because this is the one that cost real time: never `rm -rf` a worktree. Check `LinkType` (not where `Target` points — most "escaping" links are harmless hardlinks whose `Target` lists every name sharing the inode). Only `LinkType = Junction` is the hazard. Delete junctions as links with `[System.IO.Directory]::Delete(path, $false)`, deepest first, then remove the remaining tree, then `git worktree prune`. Note that `git worktree remove` may exit 0, print `Directory not empty`, and still deregister the worktree.

- [ ] **Step 3: Record the rename**

File: `2026-09-20-decision-rename-to-kestrel-ai.md`, tags `[decision]`.

Its **Decision** section must contain the full old→new name map, lifted from `docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md` §2.1. Its **Context** must state the thing that makes the map necessary: "machinery" has two roles in this repo — the product identifier (renamed) and the domain noun for the construction machinery the model detects (never renamed) — so a reader hitting `machinery-backend` in an old review diff can resolve which it was.

**Consequences** must note the two deliberate survivals: `LEGACY_SERVICE = "machinery-app"` in `backend/app/providers/keys.py` and the legacy folder name in `frontend/src-tauri/src/lib.rs`, both migration code.

- [ ] **Step 4: Record the two traps from the rename work**

- `2026-09-20-gotcha-tauri-capability-allowlist-is-runtime.md`, tags `[decision, gotcha]`: `frontend/src-tauri/capabilities/default.json` names the sidecar twice (`shell:allow-execute`, `shell:allow-spawn`). A stale name there compiles, installs and launches cleanly, then denies the spawn at runtime so the app has no backend. No test in the repo catches it; the only check is launching the built app and hitting `/api/v1/health`.
- `2026-09-20-gotcha-app-data-migration-must-run-first.md`, tags `[decision, gotcha]`: Tauri derives the app-data folder from the bundle identifier. The `appdata::migrate` call in `lib.rs`'s `setup()` must stay the first thing that touches `app_data_dir` — registering any plugin that touches it earlier (store, log, fs), or launching any build before the migration, creates the new folder and makes `migrate()` return `BothPresent` forever. Also: writing the log *before* the rename would do the same, which is why the log append sits inside the match arms.

- [ ] **Step 5: Record the heredoc trap**

`2026-09-19-gotcha-bash-heredoc-collapses-backslashes.md`, tags `[decision, gotcha]`: writing Windows paths through a Bash heredoc turns `\\` into `\`. Use the Write/Edit tools, or `chr(92)`, for any content containing Windows paths.

- [ ] **Step 6: Verify frontmatter on every note**

```bash
for f in vault/decisions/*.md; do head -1 "$f" | grep -q '^---$' || echo "MISSING FRONTMATTER: $f"; done
grep -L "^type:" vault/decisions/*.md
```

Both must produce no output.

- [ ] **Step 7: Commit**

```bash
git add vault/decisions
git commit -m "feat(vault): seed the decision log from the progress ledger"
```

---

### Task 8: Worktree scripts

**Files:**
- Create: `scripts/start-task.ps1`, `scripts/finish-task.ps1`

**Interfaces:**
- Consumes: nothing.
- Produces: the two commands `AGENTS.md` rule 1 and `CONTRIBUTING.md` reference.

- [ ] **Step 1: Write `scripts/start-task.ps1`**

```powershell
<#
.SYNOPSIS
  Start a building session in its own git worktree.
.DESCRIPTION
  Cuts task/<name> from the latest main into .claude/worktrees/<name>, pins the commit identity
  and installs the pnpm workspaces. It deliberately does NOT create a Python venv: the worktree
  uses the main checkout's interpreter (see the -Venv note in README and the shared-venv incident
  ADR in vault/decisions/).
#>
param(
  [Parameter(Mandatory = $true)][string] $Name
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$wt = Join-Path $repo ".claude\worktrees\$Name"

if (Test-Path $wt) { throw "worktree already exists: $wt" }

Write-Host "fetching origin/main..."
& git -C $repo fetch origin main 2>&1 | Out-Host

# origin may not exist yet (the repo is published in a later task); fall back to local main.
$base = 'main'
if ((& git -C $repo branch -r) -match 'origin/main') { $base = 'origin/main' }

& git -C $repo worktree add $wt -b "task/$Name" $base
if ($LASTEXITCODE -ne 0) { throw "git worktree add failed" }

# Commit identity is pinned per worktree: the email is what GitHub attributes commits to.
& git -C $wt config user.name  'Danijel Jovanovic'
& git -C $wt config user.email 'info@synapse-solutions.ai'

Write-Host "installing pnpm workspaces (hardlinked from the store, a few seconds)..."
& pnpm -C (Join-Path $wt 'frontend') install | Out-Host
& pnpm -C (Join-Path $wt 'contract') install | Out-Host

Write-Host ""
Write-Host "worktree ready on task/$Name"
Write-Host "  cd $wt"
Write-Host "backend commands use the main checkout's interpreter:"
Write-Host "  $repo\backend\.venv\Scripts\python.exe -m pytest"
```

- [ ] **Step 2: Write `scripts/finish-task.ps1`**

```powershell
<#
.SYNOPSIS
  Gate, merge and clean up a task worktree. Run from inside the worktree.
.DESCRIPTION
  Rebases onto the latest main so the gate runs against the merged state, runs the full gate,
  merges to main, then removes the worktree. Removal follows the junction rule: only directory
  reparse points are hazardous; hardlinks share inodes and are safe. Never rm -rf.
#>
param(
  [switch] $SkipGate
)

$ErrorActionPreference = 'Stop'
$wt = (& git rev-parse --show-toplevel)
if (-not $wt) { throw "not inside a git worktree" }
$wt = $wt -replace '/', '\'
$branch = (& git rev-parse --abbrev-ref HEAD).Trim()
if ($branch -notlike 'task/*') { throw "not on a task/* branch (on '$branch')" }

$repo = (& git rev-parse --git-common-dir) -replace '/', '\'
$repo = Split-Path -Parent $repo

if ((& git status --porcelain)) { throw "working tree is dirty - commit or discard first" }

Write-Host "rebasing $branch onto main so the gate runs against the merged state..."
& git fetch origin main 2>&1 | Out-Null
& git rebase main
if ($LASTEXITCODE -ne 0) {
  throw "rebase conflict - resolve it, then re-run this script"
}

if (-not $SkipGate) {
  $py = Join-Path $repo 'backend\.venv\Scripts\python.exe'
  $cargo = Join-Path $env:USERPROFILE '.cargo\bin\cargo.exe'
  $gate = @(
    @{ n = 'contract';       c = { & pnpm -C (Join-Path $wt 'contract') check } },
    @{ n = 'ruff';           c = { Push-Location (Join-Path $wt 'backend'); try { & $py -m ruff check . } finally { Pop-Location } } },
    @{ n = 'pytest';         c = { Push-Location (Join-Path $wt 'backend'); try { & $py -m pytest -q } finally { Pop-Location } } },
    @{ n = 'frontend lint';  c = { & pnpm -C (Join-Path $wt 'frontend') lint } },
    @{ n = 'frontend test';  c = { & pnpm -C (Join-Path $wt 'frontend') test } },
    @{ n = 'frontend build'; c = { & pnpm -C (Join-Path $wt 'frontend') build } },
    @{ n = 'cargo test';     c = { & $cargo test --manifest-path (Join-Path $wt 'frontend\src-tauri\Cargo.toml') } }
  )
  foreach ($g in $gate) {
    Write-Host "--- $($g.n) ---"
    & $g.c | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "gate failed at: $($g.n)" }
  }
}

Write-Host "merging $branch into main..."
& git -C $repo checkout main
& git -C $repo merge --ff-only $branch
if ($LASTEXITCODE -ne 0) { throw "merge failed" }
if ((& git -C $repo branch -r) -match 'origin/main') { & git -C $repo push origin main }

Write-Host "removing the worktree..."
Set-Location $repo
& git worktree remove $wt 2>&1 | Out-Host

if (Test-Path $wt) {
  # Expected: git refuses while node_modules is present. Remove junctions AS LINKS first.
  $escaping = Get-ChildItem -Force -Recurse $wt -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType } |
    Where-Object { @($_.Target) | Where-Object { $_ -notlike "$wt*" } }
  if (@($escaping).Count -gt 0) {
    $escaping | Select-Object FullName, Target | Format-List | Out-Host
    throw "ABORTING: a junction points outside the worktree. Delete nothing; inspect by hand."
  }
  $j = Get-ChildItem -Force -Recurse $wt -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.LinkType } | Sort-Object { $_.FullName.Length } -Descending
  foreach ($d in $j) { try { [System.IO.Directory]::Delete($d.FullName, $false) } catch {} }
  Remove-Item -Recurse -Force $wt -ErrorAction SilentlyContinue
}
& git worktree prune
& git -C $repo branch -d $branch

Write-Host ""
Write-Host "done: $branch merged into main, worktree removed, branch deleted."
Write-Host "Now write the operator a numbered 'how to test this' walkthrough, and run /wrapup."
```

- [ ] **Step 3: Syntax-check both scripts without running them**

```powershell
foreach ($f in 'scripts\start-task.ps1','scripts\finish-task.ps1') {
  $null = [System.Management.Automation.PSParser]::Tokenize((Get-Content $f -Raw), [ref]$null)
  Write-Host "parsed ok: $f"
}
```

Do **not** execute them in this task — `finish-task.ps1` merges and deletes. Task 12 exercises them once, deliberately.

- [ ] **Step 4: Commit**

```bash
git add scripts/start-task.ps1 scripts/finish-task.ps1
git commit -m "feat(scripts): add the task worktree start/finish helpers"
```

---

### Task 9: The `/wrapup` command

**Files:**
- Create: `.claude/commands/wrapup.md`

**Interfaces:**
- Consumes: Task 5 (`vault/templates/session.md`), Task 8 (the scripts it mentions).
- Produces: the `/wrapup` slash command `AGENTS.md` refers to.

- [ ] **Step 1: Write the command**

`.claude/commands/wrapup.md` is a prompt, not a script. It must instruct the agent to:

1. Determine what changed this working block: `git log --oneline main@{1}..main` or the session's own commits, plus `git diff --stat`.
2. Write `vault/sessions/YYYY-MM-DD-HHmm-<short-slug>.md` from `vault/templates/session.md`, filling: **What changed** (files, commits, key decisions), **Why** (1-3 sentences — the part `git log` cannot tell you), **Open threads**, **Next session entry point**, and **How to test** (numbered operator steps, or one line if not user-observable).
3. Set the note's frontmatter: `type: session`, `date`, `branch`, `trigger: wrapup`, `status: complete`.
4. Update `vault/00-north-star.md`: the **Now**, **Owed** and phase status sections, and bump `last-updated` in its frontmatter.
5. If the block hit a non-obvious trap, write an ADR in `vault/decisions/` from `vault/templates/decision.md`, tagged `gotcha`.
6. Commit with `docs: wrapup <slug>`, staging only `vault/`.

State explicitly that it must **not** invent progress: if nothing shipped, the note says so.

- [ ] **Step 2: Commit**

```bash
git add .claude/commands/wrapup.md
git commit -m "feat: add the /wrapup session-capture command"
```

---

### Task 10: Register and verify the vault in Obsidian

**Files:**
- Modify: `%APPDATA%\obsidian\obsidian.json` (outside the repo)

**Interfaces:**
- Consumes: Tasks 5, 6, 7.
- Produces: a vault that opens from Obsidian's switcher.

- [ ] **Step 1: Back up the registry, then add this vault**

```powershell
$f = "$env:APPDATA\obsidian\obsidian.json"
Copy-Item $f "$f.bak-2026-09-20"
$j = Get-Content $f -Raw | ConvertFrom-Json
$id = -join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })
$j.vaults | Add-Member -NotePropertyName $id -NotePropertyValue ([pscustomobject]@{ path = 'E:\Dev\Yolo\app'; ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() })
$j | ConvertTo-Json -Depth 10 | Set-Content $f -Encoding utf8
Write-Host "registered. Existing vaults preserved:"; ($j.vaults.PSObject.Properties | ForEach-Object { $_.Value.path })
```

The last line must list all four pre-existing vaults (`Danijel Work Vault`, `mubarak-ai`, `DRA (Drones, Robotics, AI)`, `Monolith`) **plus** `E:\Dev\Yolo\app`. If any is missing, restore the `.bak` and stop.

Note the vault will appear as **"app"** — Obsidian names a vault after its folder. That is accepted (spec §2); renaming `E:\Dev\Yolo\app` would break the venv, Tauri's `target/` and the Claude project directory.

- [ ] **Step 2: Operator verification — hand these steps over**

This step needs a human with the GUI. Provide them as a numbered walkthrough:
1. Open Obsidian. In the vault switcher (bottom-left), open **app**.
2. Confirm it opens on `vault/00-north-star.md` (the Homepage plugin).
3. Open `vault/moc/memory.md` and confirm the gotcha table renders as a **table**, not a code block. A code block means Dataview is not enabled — enable it under Settings → Community plugins.
4. Open `vault/moc/specs.md` and confirm the specs list renders and includes both 2026-09-20 specs.
5. Click a `[[wikilink]]` and confirm it resolves.

Record the outcome. Do not claim the vault works until a human has confirmed steps 2-5.

---

### Task 11: Publish the repository — OPERATOR-GATED

**Files:** none in the repo; creates a world-readable GitHub repository.

**Interfaces:**
- Consumes: Task 2 (scan CLEAN) and Tasks 1, 3-9.
- Produces: `origin` and the published branches Task 12 clones.

> **STOP.** This step makes the code, the dev-memory vault, `docs/evidence/` and the full commit history **world-readable and permanently archivable**. Confirm with the operator immediately before running it, even though the spec approves the intent. Do not run it in an unattended batch. If Task 2's verdict is anything other than CLEAN, do not run it at all.

- [ ] **Step 1: Re-confirm the preconditions**

```bash
gh auth status
git status --short
git log --oneline -1
cat docs/evidence/2026-09-20-secret-scan.md | tail -5
```

`gh` must be the **Synapsekw** account; the tree must be clean; the scan verdict must read CLEAN.

- [ ] **Step 2: Create the repo and push `main`**

```bash
gh repo create Synapsekw/kestrel-ai --public --source . --remote origin --description "Windows desktop app for aerial construction-machinery detection: dataset prep, annotation, YOLO training and inference."
git push -u origin main
```

- [ ] **Step 3: Push the other branches**

```bash
git push origin s6-packaging-acceptance usability-wave1 wave1-s2-trial
```

- [ ] **Step 4: Verify from GitHub's side**

```bash
gh repo view Synapsekw/kestrel-ai --json name,visibility,defaultBranchRef,url
gh api repos/Synapsekw/kestrel-ai/branches --jq '.[].name'
```

Expect visibility `PUBLIC`, default branch `main`, and all four branches listed.

---

### Task 12: Verify the second-machine story

The whole point of the remote is that another computer can pick this up. Prove it rather than assuming it.

**Files:** none in the repo. Uses a scratch directory.

**Interfaces:**
- Consumes: Task 11.
- Produces: the evidence that closes the plan.

- [ ] **Step 1: Clone into a scratch directory**

```bash
cd "$(mktemp -d)" && git clone https://github.com/Synapsekw/kestrel-ai.git && cd kestrel-ai
```

- [ ] **Step 2: Confirm everything a second machine needs arrived**

```bash
for p in vault/00-north-star.md vault/decisions vault/templates/session.md .obsidian/plugins/dataview .superpowers/sdd AGENTS.md CLAUDE.md CONTRIBUTING.md scripts/start-task.ps1 scripts/finish-task.ps1 .claude/commands/wrapup.md docs/superpowers/specs; do [ -e "$p" ] && echo "ok   $p" || echo "MISSING $p"; done
ls .superpowers/sdd
```

Every line must say `ok`, and the SDD listing must show the wave directories.

- [ ] **Step 3: Confirm what should NOT have travelled**

```bash
for p in backend/.venv node_modules frontend/node_modules .env; do [ -e "$p" ] && echo "LEAKED: $p" || echo "correctly absent: $p"; done
du -sh .git
```

No `LEAKED` lines. Repo size should be well under 100 MB.

- [ ] **Step 4: Exercise the worktree scripts once, in the real checkout**

Back in `E:\Dev\Yolo\app`:

```powershell
.\scripts\start-task.ps1 smoke-check
```

Then in the new worktree make one trivial change (add a line to `vault/sessions/.gitkeep` or touch a comment), commit it by path, and run:

```powershell
.\scripts\finish-task.ps1
```

Expect: the gate runs, the merge succeeds, the worktree is removed, the branch is deleted. Confirm afterwards:

```bash
git worktree list          # only the main checkout and .worktrees/wave1
git branch                 # no task/smoke-check
```

- [ ] **Step 5: Record the result**

Run `/wrapup` to write the session note — which also serves as the first real exercise of Task 9's command.

---

## Verification checklist

- [ ] `.superpowers/sdd/` is tracked and its wave directories are in the repo (Tasks 1, 12)
- [ ] Secret scan verdict is CLEAN, written to `docs/evidence/2026-09-20-secret-scan.md` (Task 2)
- [ ] `CLAUDE.md` → `AGENTS.md`, and every path named in `AGENTS.md` exists (Task 3)
- [ ] `CONTRIBUTING.md` carries the six-command gate verbatim (Task 4)
- [ ] Every file under `vault/` has `type` frontmatter (Tasks 5-7)
- [ ] `vault/decisions/` holds ~13 ADRs including the Inno-Setup, shared-venv, capability-allowlist and app-data-migration gotchas (Task 7)
- [ ] Obsidian opens the vault on the north star, with Dataview rendering tables not code blocks — **confirmed by a human** (Task 10)
- [ ] `gh repo view Synapsekw/kestrel-ai` reports PUBLIC with four branches (Task 11)
- [ ] A fresh clone contains vault, SDD state, agreement and scripts, and contains no venv, `node_modules` or `.env` (Task 12)
- [ ] `start-task.ps1` → trivial edit → `finish-task.ps1` completes green and cleans up (Task 12)
