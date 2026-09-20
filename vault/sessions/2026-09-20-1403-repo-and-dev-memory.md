---
type: session
date: 2026-09-20
branch: main
trigger: wrapup
status: complete
tags: [session]
related: []
---

# Repo and dev-memory public-prep session

## What changed

Built out the public-repo preparation plan (`docs/superpowers/plans/2026-09-20-repo-and-dev-memory.md`)
end to end, then applied a fix wave from a final whole-branch review (no Critical findings, 11
Important). Commits on `main`, oldest first:

- `409e0c7` chore: track the SDD wave state so it travels between machines
- `f6dbd41` docs: secret scan before the repo goes public
- `427e808` chore: group the SDD ignore rule with the other local-state rules
- `645ba7a` docs: add the working agreement (CLAUDE.md -> AGENTS.md)
- `7a12ae4` docs: add the contributor reference
- `209645f` docs: tighten the secret scan record's screenshot and branch coverage
- `9c1656c` feat(vault): scaffold the Obsidian dev-memory vault
- `42a98b8` feat(scripts): add the task worktree start/finish helpers
- `ebc8642` feat(vault): north star, product context and the maps of content
- `9cfa632` feat(vault): seed the decision log from the progress ledger
- `e7d29d8` fix(scripts): guard the origin fetch and drop the unsafe native stderr redirect
- `3844b35` feat: add the /wrapup session-capture command
- `a4872c7` fix(scripts): drop the last native stderr redirect before the junction cleanup
- `50dab0f` fix(vault): cite the right commit for the stale 8/8 acceptance run

Plus this session's fix wave (commits follow this note — see `git log` for the exact SHAs):
corrected two false statements in `vault/moc/memory.md` (the SDD directory is tracked, not
git-ignored; the empty-ADR-table caveat was stale — 18 ADRs exist, 5 tagged `gotcha`); hardened
`scripts/start-task.ps1` and `scripts/finish-task.ps1` (guarded the origin fetch, rebase onto
`origin/main` when it exists, checked the push and main-checkout exit codes, asserted the main
checkout is clean and on `main` before merging — all without touching the reviewed junction-removal
block); de-hardcoded the operator's home directory out of `CONTRIBUTING.md`; wrote this seed session
note; added `vault/decisions/2026-09-20-gotcha-powershell-native-stderr-under-stop.md`; added `vault/`
to the `README.md` layout table with a pointer to `AGENTS.md` / `CONTRIBUTING.md` /
`vault/00-north-star.md`; configured Templater's template folder
(`.obsidian/plugins/templater-obsidian/data.json` → `vault/templates`) and replaced the
non-existent `tp.user.git_branch()` call in `vault/templates/session.md` with a plain placeholder;
and fixed several small accuracy issues (`AGENTS.md`'s `check-tokens.mjs` path, `vault/README.md`'s
frontmatter-type list missing `spec`, and two stale commit citations in `vault/00-north-star.md`).

## Why

The repo is about to be published (operator-gated, not yet done). This work gives it a tracked
Obsidian dev-memory vault, a working agreement (`AGENTS.md` / `CONTRIBUTING.md`), worktree scripts
for a second machine, and a `/wrapup` capture command — then a final review caught real defects in
that scaffolding (mostly on the second-machine/remote path, which had never been exercised) and two
statements in the vault itself that had gone stale as the vault filled in around them.

## Open threads

- **The repo is NOT yet published.** Publishing is Task 11, operator-gated, and is explicitly out of
  scope for this session.
- **The second-machine clone test is NOT done.** Task 12 (cloning onto a second machine and running
  `start-task.ps1` / `finish-task.ps1` against a real `origin`) has not been performed. The script
  fixes in this session are reasoned through, not exercised against a live remote.
- **The Obsidian GUI verification is owed to the operator.** Nobody has opened this vault in the
  Obsidian app yet to confirm Dataview queries render, Templater expands `vault/templates/session.md`
  without error, and the Homepage plugin opens `vault/00-north-star.md` on startup.
- **The 8/8 acceptance run is stale.** It was measured at `177f68b`, which predates the Kestrel AI
  rename (`vault/00-north-star.md` §5 has the detail). Re-running acceptance against the renamed,
  installed build is tracked separately (Task 11 Step 5 of the rename plan) and was not touched here.
- **The first live `finish-task.ps1` round trip failed.** Task 12's smoke run (`task/smoke-check`)
  exercised the gate for real for the first time: the first six steps passed (contract check, ruff,
  583 pytest, frontend lint, frontend test, frontend build), but the seventh, `cargo test`, failed —
  Tauri's build script resolves the frozen-sidecar `externalBin` resource at compile time, and
  `frontend/src-tauri/binaries/kestrel-backend-*.exe` is git-ignored, so the fresh worktree never had
  it. The gate was unachievable as written. Fixed by making that step conditional on the sidecar's
  presence under the worktree being gated — it runs when found, otherwise skips with an explicit
  printed reason and does not fail the gate. See
  `vault/decisions/2026-09-20-gotcha-cargo-test-needs-the-frozen-sidecar.md`. The `task/smoke-check`
  worktree itself is left as-is for the controller to finish that round trip.

### Update — later the same day: publish landed, round trip paused

The items above were true when this note was first written. Since then:

- **Task 11 shipped: the repo is published.** This supersedes the "repo is NOT yet published"
  bullet above. It is now `https://github.com/Synapsekw/kestrel-ai`, public, default branch `main`,
  MIT licensed, with `main`, `s6-packaging-acceptance`, `usability-wave1` and `wave1-s2-trial`
  pushed.
- **The fresh-clone test (Task 12 Steps 1-3) passed for real.** A scratch clone from GitHub had
  every required path — vault, 19 ADRs, vendored Dataview, all six SDD wave directories,
  `AGENTS.md`/`CLAUDE.md`/`CONTRIBUTING.md`/`LICENSE`, both worktree scripts, `/wrapup` — and leaked
  nothing that should be excluded: no venv, no `node_modules`, no `.env`. `.git` came out at 28 MB.
- **The round trip is paused, not complete.** After the `cargo test` failure and fix recorded above,
  the operator paused before Task 12 Step 4 could merge or push. Worktree
  `.claude/worktrees/smoke-check` and branch `task/smoke-check` (at `ad3633e`) are intentionally
  left in place, ready to resume — do not remove them. The pause is deliberate: finishing the round
  trip would push `main`, and a parallel session's in-flight OBB spec is also sitting on local
  `main`; the operator chose to wait rather than carry that spec to the public remote before the
  parallel session is ready. `start-task.ps1` and the gate were exercised for real; the merge, the
  push and the junction-safe teardown were not.
- **Unpushed commits on local `main`.** At minimum `59b28a4` (the parallel session's OBB spec, not
  this plan's work) and `4807473` (this plan's `cargo test` gate fix) are unpushed. As of this
  update, two further parallel-session commits (`8bf1add`, `c739d7e`) have also landed on local
  `main` and are likewise unpushed. `origin/main` is still at `0ce41f5` — behind local `main` by all
  four commits. A clone from GitHub right now would not have the conditional-gate fix.
- The Obsidian GUI verification bullet below is still owed, unchanged.

## How to test

This session's changes are documentation, vault content and PowerShell scripts — nothing in
`backend/`, `frontend/src/`, `frontend/src-tauri/src/` or `contract/` changed, so there is no app
behavior to click through. To verify by hand:

1. Open `E:\Dev\Yolo\app` as an Obsidian vault (or reload it if already open) and confirm
   `vault/00-north-star.md` opens automatically (Homepage plugin) with no console errors.
2. Confirm Dataview queries render as tables, not code blocks — e.g. the "Gotcha decisions" query in
   `vault/moc/memory.md` should list 6 rows (5 before this session's wave, plus the new ADR this
   wave itself added: `2026-09-20-gotcha-powershell-native-stderr-under-stop.md`).
3. In Obsidian, create a note from `vault/templates/session.md` via Templater (folder template or the
   "Insert Template" command) and confirm it expands without a `tp.user.git_branch` error, filling
   `date:` and leaving `branch:` as the plain placeholder.
4. In a PowerShell 5.1 window: `[System.Management.Automation.PSParser]::Tokenize((Get-Content -Raw
   scripts\start-task.ps1), [ref]$null).Count` and the same for `finish-task.ps1` — both should return
   a token count with no parse errors (already done in this session; re-run to confirm nothing
   regressed).
5. `grep -n '2>&1' scripts\*.ps1` should return nothing.
6. Read `README.md`'s Layout table and confirm `vault/` is listed and the pointer paragraph names
   `AGENTS.md`, `CONTRIBUTING.md` and `vault/00-north-star.md`.
7. Do **not** run `scripts\finish-task.ps1` for real yet against a fabricated remote — it merges,
   pushes and deletes, and the push/rebase-onto-`origin/main` paths are still untested against a live
   `origin`. That verification belongs to Task 12.

## Next session entry point

Task 11 (publish the repo, operator-gated) and Task 12 (second-machine clone test, which is the
first real exercise of `scripts/start-task.ps1` / `scripts/finish-task.ps1` against a live `origin`)
are next. After Task 12, re-run acceptance against the renamed, installed Kestrel AI build
(`vault/00-north-star.md` §5) — that is unrelated to this vault work but is the other open item
blocking a clean "current state" claim.

**Update — as of the "round trip paused" note above:** Task 11 is done. Task 12 is partway done and
paused (fresh-clone test passed; the live round trip failed once at `cargo test`, was fixed, then
paused by operator decision before merge/push — see above and `vault/00-north-star.md` §5). The
actual next session entry point is to resume from worktree `.claude/worktrees/smoke-check` /
branch `task/smoke-check` (`ad3633e`) once it's time to push, then continue with the acceptance
re-run this paragraph already names.
