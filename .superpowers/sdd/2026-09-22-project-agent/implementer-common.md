# Implementer rules (read fully before starting)

Project: Kestrel AI — Tauri 2 + FastAPI + YOLO Windows desktop app. We are adding a **project agent**:
an in-project AI drawer (OpenAI or Claude, user's own key) that operates the app through tools.
The spec is `docs/superpowers/specs/2026-09-22-project-agent-design.md` (read the sections relevant
to your task). The contract is already done in `contract/openapi.yaml` (search "project agent" and the
`Agent*` schemas). Shared neutral types are in `backend/app/project_agent/history.py` — do not change
them; if you believe they must change, report NEEDS_CONTEXT.

Worktree (work only here): `E:\Dev\Yolo\app\.claude\worktrees\project-agent`, branch `task/project-agent`.
Other implementers are working **in parallel in this same worktree** on other files. Therefore:
- Touch only the files your brief lists. Never revert, format, or stage files you did not write.
- Stage by explicit path (`git add <paths>`), never `git add -A` / `git add .` / `commit -a`.
  Run `git branch --show-current` before committing; it must print `task/project-agent`.
  If git reports `index.lock` exists, wait ~5 s and retry (another worker is committing).
- Commit messages: Conventional Commits, and end with the line
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- Lint only your own files: `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m ruff check <files>` and
  `... -m ruff format <files>` (backend), `pnpm exec eslint <files>` + `pnpm exec prettier --check <files>`
  (frontend, from `frontend/`). Run your own test files; a full-suite failure in a file you do not own
  is not yours — mention it in the report.

Backend: Python 3.11 at `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` (never create a venv in the
worktree). Run pytest from the worktree's `backend/` directory:
`E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe -m pytest tests/<file> -q`.
Fixtures live in `backend/tests/conftest.py` (`app`, `client`, `project_dir`, `make_jpeg`, `settings`);
keys in tests use `MemoryKeyStore` (already installed on `app.state.keys` by the `app` fixture).

Shell notes (Windows, Git Bash tool): heredocs collapse `\\` to `\` — write files containing backslashes
with the Write/Edit tools, not heredocs.

Hard rules from the project:
- API keys are read only via `app.state.keys.get(provider)` and are never stored, logged, returned, or
  placed in tool input/results/errors.
- Logs never contain prompts, model output, tool payloads or SDK exception text.
- Hot-path reads are bounded; never load a full image set into memory.
- No test may call a paid provider (fake the SDK clients).

Follow TDD: write the failing test, run it (see it fail for the expected reason), implement, run it green.

You do not dispatch subagents (not helpers, not reviewers). Self-review means reading your own diff.

Report: write the full report to the report file named in your dispatch (what you implemented, tests
and results, TDD evidence RED/GREEN with commands and output excerpts, files changed, self-review
findings, concerns). Then reply with ONLY (under 15 lines): Status (DONE | DONE_WITH_CONCERNS |
BLOCKED | NEEDS_CONTEXT), commits (short SHA + subject), one-line test summary, concerns, report path.
If BLOCKED or NEEDS_CONTEXT, put the specifics in the reply itself.
If something is unclear, ask (NEEDS_CONTEXT) rather than guess.
