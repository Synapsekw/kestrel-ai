# Task 7 report: integration checks (project agent)

## What was implemented

Two new test files only, as scoped by the brief:

1. `frontend/e2e/project-agent.spec.ts` — mock-mode Playwright spec. Navigates to
   `/p/{projectId}` (Prism serves `contract/openapi.yaml` examples on 127.0.0.1:4010, Vite on
   127.0.0.1:1420), clicks the header's "Project agent" button, confirms the non-modal dialog with
   `aria-label="Project agent"` appears, fills the Message field and clicks Send, and asserts (via
   `page.waitForRequest`) that a `POST …/projects/{id}/agent/turns` is made with the expected body
   (`provider: "anthropic"`, the typed message).

   One route is overridden: `GET /api/v1/projects/{id}/agent`. The `AgentConversation` schema in
   `contract/openapi.yaml` has no example of its own, so Prism's dynamic mock falls back to the
   `AgentTurn` schema's own example for the `turn` field — which is `state: "running"`. That locks
   the composer (`busy` → `locked` → Send disabled) before the test ever gets to type a message. The
   spec fulfills that one route with `{ items: [], turn: null }` so the drawer starts idle, exactly
   the pattern `query.spec.ts`/`setup-agent.spec.ts` already use for endpoints whose baked-in example
   doesn't fit the scenario under test. This is worth flagging to whoever owns the contract: it's an
   easy trap for the next spec that opens the drawer via mock mode without expecting this.

   `setup-agent.spec.ts` already opens "Setup agent" from the Projects screen and covers it
   thoroughly (two tests, including the missing-credentials path), so nothing was duplicated there
   per the brief's "if setup-agent.spec.ts doesn't already cover that" clause.

2. `backend/tests/test_project_agent_e2e.py` — HTTP-only (`TestClient`, no direct `store`/`runner`
   calls). Imports `FakeLlm`, `answer`, `calls`, `EmptyProvider` from `test_project_agent_runner.py`
   (all plain classes/functions, not fixtures — same reuse pattern already used elsewhere in this
   suite, e.g. `test_empties.py` importing `FakeProvider`/`run_and_wait` from `test_query_runs.py`).
   One test, `test_label_the_first_five_images_end_to_end`, scripts:
   `update_classes(add=[dump_truck])` → `label_images(cloud_provider)` → (turn parks at
   `awaiting_approval`, approval card has a numeric `estimated_cost > 0`) → `POST .../approval
   {"approve": true}` → final `answer(...)`. It asserts: `dump_truck` was added to the project's
   classes; the created query run's `image_ids` equal the first 5 images by path (from a 6-image
   fixture, imported in reverse creation order so path order differs from creation order — same
   trick as the runner test's `image_ids` fixture); a job exists for that run and `GET
   .../jobs/{id}` is 200; the turn ends `succeeded` with a final assistant text; and `GET /agent`
   shows both tool items (`update_classes`, `label_images`) with `tool_status == "ok"` and a
   non-empty `tool_summary`. It also keeps the runner test's no-leaked-key checks (the fake key
   never appears in any LLM call or anywhere in the project folder on disk) since they're cheap and
   match the project's hard rule that keys never reach a log, payload or file. No paid provider is
   ever called: the model is fully scripted, and `app.inference.jobs.get_provider` is monkeypatched
   to the runner test's `EmptyProvider` so the background labeling job never reaches a real SDK.

## TDD evidence

This task is integration coverage over an already-built, already-tested system (backend runner,
tools, store, llm all have their own unit/integration suites from earlier tasks), so "red" here
means "the new assertions fail against the current code for the expected reason" rather than
driving new production code. Both files were written test-first in the sense that they were run
immediately after being written and iterated on their actual (not assumed) failures:

- Backend: the test passed on the first run (`1 passed in 1.89s`) — the flow it drives was already
  fully implemented; the value here is the fixed HTTP-only regression harness, not a new backend
  behaviour.
- Frontend: the first run genuinely went **red** for a real reason — `Test timeout of 30000ms
  exceeded` / `Send` button stuck disabled. I did not just relax the assertion; I diagnosed it with
  `curl` against the mock directly (`GET .../agent` → `"turn":{"state":"running",...}` — the
  `AgentTurn` example, as explained above) and fixed the root cause (added the `page.route`
  override), then reran to green. That is the RED → understand → fix → GREEN cycle for this test.

Commands and results:

```
# backend, from backend/
.venv\Scripts\python.exe -m pytest tests/test_project_agent_e2e.py -q
  -> 1 passed in 1.89s (first run, then 2.37s after ruff format)

.venv\Scripts\python.exe -m ruff check tests/test_project_agent_e2e.py
  -> 1 error (import-sort), fixed with --fix
.venv\Scripts\python.exe -m ruff format tests/test_project_agent_e2e.py
  -> reformatted
.venv\Scripts\python.exe -m ruff check / -m ruff format --check tests/test_project_agent_e2e.py
  -> All checks passed! / 1 file already formatted

# frontend, from frontend/
pnpm exec playwright test e2e/project-agent.spec.ts
  -> RED (1st): Test timeout 30000ms exceeded, Send stayed disabled
  -> GREEN (2nd, after the GET /agent route fix): 1 passed (5.3s)

pnpm exec playwright test
  -> 62 passed (19.9s) — the whole suite, including the new spec (test #10) and
     setup-agent.spec.ts (Setup agent open/close, missing-credentials path)

pnpm exec eslint e2e/project-agent.spec.ts
pnpm exec prettier --check e2e/project-agent.spec.ts
  -> clean, no output / "All matched files use Prettier code style!"
```

## Ports check (before running e2e)

`netstat -ano | findstr ":1420 :4010"` was run before starting: both free. During debugging I
briefly started a standalone Prism instance by hand to inspect a raw mock response (once
accidentally against the *main checkout's* `contract/openapi.yaml` — wrong directory — which I
killed immediately by PID once noticed, then a second time correctly against the worktree's
contract to confirm the `AgentTurn`-example theory with `curl`). Both manual instances were killed
(`taskkill /PID … /F`) before the real Playwright runs, which manage their own
webServer lifecycle (start-if-needed, always torn down after the run) per
`frontend/playwright.config.ts`. A final `netstat` after the full suite run showed only
`TIME_WAIT` entries, no `LISTENING` sockets left on 1420/4010.

## Files changed

- `backend/tests/test_project_agent_e2e.py` (new)
- `frontend/e2e/project-agent.spec.ts` (new)

No existing file was edited — matches the brief's "only these files" / "do not edit any existing
file except to add your two new test files."

## Self-review findings

- Confirmed via `git status --porcelain` before committing that only the two new files were
  staged (no `git add -A`), and `git branch --show-current` printed `task/project-agent` before
  the commit.
- Re-read both diffs after ruff/eslint/prettier auto-fixed formatting; nothing unexpected changed
  beyond import ordering in the backend file.
- The backend test intentionally duplicates the runner suite's no-key-leak assertions rather than
  inventing new ones; it seemed better to keep this file focused on the HTTP-only, cross-cutting
  "does the whole thing work through the real routes" story per the brief, rather than growing
  scope.
- The frontend spec's one non-obvious piece — the `GET /agent` route override — is called out
  above and in a comment in the spec itself, since it's the kind of thing a future spec author
  would otherwise rediscover the hard way.

## Concerns

- The `AgentConversation` schema in `contract/openapi.yaml` has no explicit example, so any future
  mock-mode Playwright spec that opens the project agent drawer without first overriding `GET
  .../agent` will hit the same "composer looks locked because the mock's default turn is
  `running`" trap. Not something I changed the contract for here (out of scope / brief says the
  contract is already done and shared types are frozen), but worth a one-line note in
  `docs/superpowers/specs/2026-09-22-project-agent-design.md` or as a follow-up ADR if another
  implementer hits it too.
- Per `implementer-common.md`, I only ran/lint my own two files; I did not run the full backend or
  frontend suites, so I cannot vouch for the state of files other implementers may be editing
  concurrently in this same worktree.
