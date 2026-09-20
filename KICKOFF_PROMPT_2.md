# Kickoff: make Kestrel AI fully usable (goal 2)

You are the goal owner for the second phase of the Windows desktop app in `E:\Dev\Yolo\app`: turn the delivered, installable app into one a person can use day to day without reading the code. Phase 1 (spec, six sub-projects, installer, acceptance run) is complete and documented; do not rebuild it. Read this file, then the state of the project, then start.

## Read first

1. `docs/progress.md`: the state table, decisions 1–13, checkpoints 1–4, the acceptance run, the two venv incidents and the rules they produced. The last verified commit is named there.
2. `docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md`: the design the app implements (section 2 decisions are still locked; sections 5–13 describe every subsystem).
3. `README.md`: build, install, dev against the mock and the real backend, every test suite, the checkpoint and acceptance drivers.
4. The three wave ledgers `docs/superpowers/plans/2026-09-18-wave{1,2,3}-ledger.md`: every ruling and every deferred minor. Some of those minors are usability problems; most are not.
5. `KICKOFF_PROMPT.md`: the phase-1 mandate. Every guardrail in it still applies (repeated below).

## What "fully usable" means

The user opened the installed app and could not find their way: on the Projects screen every sidebar entry except Projects is greyed out (Data, Review, Models, Train, Query, Settings are all per project), nothing says "open a project first", and provider API keys, which are global, can only be reached inside a project. That is the class of problem to remove. The bar: a machinery-detection analyst who has never seen the code can install the app, create a project, import a folder, label, train, run queries locally and with a cloud provider, review, export, and understand every state the app can be in, with no dead ends, no unexplained disabled controls, no silent failures, and no step that needs a terminal.

Work in this order:

1. **Usability walk-through first, as the user.** Launch the installed app (or `pnpm tauri dev` in env mode) and walk every screen and every flow the way a new user would, with the Playwright-over-CDP drivers as a tool, not a substitute for looking at the screens (screenshots, and read them). Write the friction list to `docs/usability/2026-09-19-walkthrough.md`: one line per problem, where it is, what the user sees, what they expected, severity (blocks / confuses / annoys). Include the known items below. Show the list to the user before fixing anything and ask which items they consider blocking; then proceed without further approval.
2. **Fix the blocking and confusing items**, smallest change first, each with a test (TDD), each as its own commit, in the owning code (frontend for navigation and copy, backend only when a state is not exposed). Interface changes to the contract go through you: edit `contract/openapi.yaml`, regenerate the client, keep the contract test green.
3. **Fill the functional gaps that the walk-through exposes** (features a user needs that phase 1 scoped out or left thin): treat each as a mini sub-project with a plan under `docs/superpowers/plans/`, implemented with sub-agents in worktrees, reviewed before merge, verified by you on the real app. Do not start a gap before its predecessor is merged and verified.
4. **Re-run checkpoint 4 and the acceptance driver on a rebuilt installer** at the end of every wave; keep `docs/progress.md` current (wave, item, branch, state, blockers, last verified commit) so a new session can resume.

Known items to put on the list (found already; verify each on the app before ranking):

- Sidebar entries are disabled with no hint on the Projects screen (`frontend/src/app/Shell.tsx` `navItems`); Settings is unreachable until a project is open; provider keys (global, Credential Manager) live in the per-project Settings screen.
- Train form: 50 epochs and imgsz 1280 are the defaults with no guidance; a training on a tiny dataset produces a useless model with no warning.
- Query screen: at the default confidence a freshly trained model returns nothing; the review queue then shows an empty list with no explanation.
- Pre-annotation with the COCO weights is silent when it finds nothing on an image (the take-off frames of a flight), and the editor gives no sign that pre-annotation ran.
- The Anthropic and OpenAI providers have never executed a live request in this environment (no key); acceptance step 7 is still pending. If the user provides a key, run step 7 with `frontend/scripts/acceptance.mjs --project-id eb32cbef-7d64-4b1e-8bfb-fd25cc956ba7` first and fix whatever it finds.
- The usability-flavoured minors in the ledgers: the Train form remount was fixed; still open are the missing request timeouts in the editor (a hung request stalls the per-image queue), "Showing N images" counting URL ids, ModelTable rows not keyboard-focusable, no cleanup of old tile caches under `runs/`, the untiled local query image size (1280) differing from pre-annotation (2560) with no note in the UI.

## How to work

- Use the superpowers skills: brainstorming with the user for anything that changes the product's shape (new screens, new flows), writing-plans for each gap, subagent-driven-development with using-git-worktrees for implementation, test-driven-development in every task, requesting-code-review before every merge, verification-before-completion. Small copy and navigation fixes you may do yourself, test-first.
- Model tiers as in phase 1: design and reviews on the most capable model, well-specified implementation mid-tier, mechanical work cheapest. You remain goal owner; never delegate integration, merging or verification. Sub-agent claims are not evidence: after every merge run backend (`pytest -q`, `pytest -m gpu -q`, `ruff check`), contract (`pnpm --dir contract check`) and frontend (`pnpm lint`, `npx vitest run`, `pnpm build`, `pnpm e2e`) suites yourself, then the flow on the real app.
- Sub-agents use the absolute interpreter `E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe` with their cwd in their worktree; they never install packages, never `git clean`, and never create links or junctions to the shared venv. Before removing a worktree, list reparse points (`Get-ChildItem -Recurse -Attributes ReparsePoint`) and remove junctions with `rmdir`; never `rm -rf` a worktree (this deleted the venv once).
- The Bash tool collapses `\\` to `\` inside heredocs on this machine; write files with Windows paths through the Write or Edit tools.

## Guardrails (unchanged from phase 1)

- Never modify anything under `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`. `E:\Dev\Yolo\Ahmadia Construction Data` is read-only original imagery; tests use copies from `E:\Dev\Yolo\data\raw\ahmadia`.
- Provider API keys go into Windows Credential Manager through the backend's provider endpoint. Never write a key into a file, a fixture, a log or a commit; live provider tests read the key from an environment variable at runtime and skip when it is absent.
- Do not vendor Label Studio source and do not use its name in the product.
- Nothing installed system-wide (Rust and MSVC already present). Backend uses `backend/.venv`; frontend uses local `node_modules`; the Inno Setup compiler comes from the `innosetup-compiler` npm package.
- Ports 8080 (Label Studio) and 9090 (ML backend) untouched. Stop only processes you started.
- Commit early and often on branches; merge to `main` only after review and verification; never force-push `main`.

## Reference facts

- Reference machine: RTX 5070 Ti, driver 591.86, torch 2.14.0+cu130, ultralytics 8.4.154, Python 3.11.15 (uv-managed), Node 24, pnpm 10, Tauri CLI 2.11.4, PyInstaller 6.22.3. Pins stay.
- Installed app: `%LOCALAPPDATA%\Programs\Kestrel AI\kestrel-ai.exe`; installer `dist/Kestrel AI_0.1.0_x64-setup.exe` (`pnpm build:installer` in `frontend/` after `backend/scripts/build.ps1`; `%USERPROFILE%\.cargo\bin` must be on PATH). App data and the sidecar log: `%APPDATA%\ai.synapse-solutions.kestrel-ai`.
- Existing projects: the acceptance project (3299 frames, folder `%TEMP%\acceptance-project`, id `eb32cbef-7d64-4b1e-8bfb-fd25cc956ba7`) is a good large test bed; it may be deleted when no longer needed.
- Drivers: `frontend/scripts/checkpoint4.mjs` (installed app, cold start, health, sidecar exit), `frontend/scripts/acceptance.mjs` (spec 13.5, parametrised, resumable), `scripts/acceptance.md`.

## Definition of done for this phase

- The friction list is empty of blocking and confusing items, each closed by a commit named in `docs/usability/2026-09-19-walkthrough.md`.
- A new user can complete the full flow from the installed app with no terminal and no reading of code, demonstrated by a recorded walk-through (screenshots per step) in `docs/evidence/usability/`.
- Acceptance step 7 has run once with a real key (if the user provides one) and the provider path is verified live.
- All suites green on `main`; installer rebuilt from the final commit, checkpoint 4 and the acceptance driver re-passed on it; `docs/progress.md` current.

Start with the walk-through. Show the friction list, ask which items block, then proceed.
