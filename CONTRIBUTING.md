# Contributing to Kestrel AI

Thanks for working on Kestrel AI. This is the long-form reference `AGENTS.md` points at.

## Prerequisites

- Windows 11, NVIDIA GPU with driver 591.86 or newer.
- Node 24 and pnpm 10.
- uv 0.11 or newer (fetches CPython 3.11.15 on demand).
- Rust stable for `x86_64-pc-windows-msvc` and the MSVC C++ build tools with a Windows 10 SDK.
- About 20 GB free for the frozen backend, the bundle and the installer.

Full detail (ports, pins, WebView2, what's installed where): `README.md` → "Prerequisites
(reference machine)".

## Setup

See `README.md` → "Set up once" and "Run in development" for the full commands (`uv venv`, `uv pip
install`, `pnpm install` in `contract/` and `frontend/`, then `scripts\dev.ps1`).

## Scripts

| Script | Purpose |
| --- | --- |
| `backend\scripts\build.ps1` | Freeze the backend with PyInstaller into `frontend/src-tauri/binaries/` |
| `backend\scripts\smoke_frozen.ps1` | Prove the frozen backend (health, GPU, predict, worker, export, keyring) before packaging |
| `pnpm -C frontend build:installer` | Build the Tauri release binary and compile the Inno Setup installer |
| `pnpm -C contract check` | Spectral lint + regenerate the TS client + fail if it's stale |
| `pnpm -C contract mock` | Run the Prism mock server on `127.0.0.1:4010` |
| `scripts\dev.ps1` | Start the UI in development (`-Mode mock` or `-Mode backend`) |
| `scripts\start-task.ps1 <name>` | Cut a task worktree at `.claude/worktrees/<name>` on `task/<name>` and prep it |
| `scripts\finish-task.ps1` | Run the gate, merge the task branch to `main`, remove the worktree, delete the branch |

## Branching workflow

`main` is the integration home — do not build directly in it. Every non-trivial session:

1. `scripts\start-task.ps1 <name>` — cuts a worktree at `.claude/worktrees/<name>` on `task/<name>`.
2. Build in that worktree, on that branch.
3. `scripts\finish-task.ps1` — runs the gate below, merges to `main`, removes the worktree and
   deletes the branch.

A release is a tagged installer build, not a branch promotion — there is no `develop`/`main` split
here.

## Commit hygiene

- Stage explicitly by path (`git add <specific/paths>`). Never `git add -A`, `git add .`, or
  `git commit -a` — they sweep in everything in the tree, including other sessions' work in a
  shared checkout.
- Run `git status` first and confirm every staged path is yours before committing.
- Sweep in unrelated changes only when explicitly asked.

## Commit messages

Conventional Commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`, etc. Imperative
subject line; body explains *why*, not just what changed.

## Testing

The gate, verbatim:

```
pnpm -C contract check
cd backend; .\.venv\Scripts\python.exe -m ruff check .; .\.venv\Scripts\python.exe -m pytest
pnpm -C frontend lint
pnpm -C frontend test
pnpm -C frontend build
cargo test --manifest-path frontend/src-tauri/Cargo.toml
```

Two things that trip people up:

- **A worktree has no venv of its own.** `backend/.venv` is not created per worktree; backend
  commands run against the main checkout's interpreter, e.g.
  `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe`. Do not `uv venv` a fresh one inside a
  worktree.
- **`cargo` is not on PATH** in every shell. If `cargo test` fails to resolve, call the real binary
  directly: `C:\Users\D\.cargo\bin\cargo.exe test --manifest-path frontend/src-tauri/Cargo.toml`.

Packaging changes additionally require `backend\scripts\build.ps1`,
`backend\scripts\smoke_frozen.ps1` and `pnpm -C frontend build:installer` — see `README.md` →
"Build".

## Dev memory

This repo keeps a tracked Obsidian vault at `vault/`: `00-north-star.md` (the homepage), `sessions/`
(one note per working block) and `decisions/` (ADRs for non-obvious traps). Every vault note carries
`type` frontmatter — frontmatter-or-die. At the end of a working block, run `/wrapup` to log a
session note in `vault/sessions/` and bump `vault/00-north-star.md`.

**A real trap: `.superpowers/sdd/.gitignore` regenerates itself.** The superpowers SDD tooling
writes a `.gitignore` containing a single `*` into `.superpowers/sdd/` and rewrites it on every
run, so it cannot be deleted durably. Files already tracked there are unaffected — git ignore rules
never apply to tracked files, which is why the existing SDD files travel with the repo fine — but a
**new** wave's artifacts are silently skipped by a plain `git add`. Stage a new wave explicitly with
`git add -f .superpowers/sdd/<wave>`, and check `git status` afterwards to confirm the files are
actually staged.
