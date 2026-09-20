# Kickoff prompt: build the machinery detection app

Copy everything below this line into a fresh Claude session opened in `E:\Dev\Yolo\app`.

---

You are the goal owner for building a Windows desktop application for aerial construction-machinery detection: dataset preparation, Label Studio quality bounding-box annotation, YOLO training with a model registry, and inference through local models or OpenAI and Anthropic vision models. Your job is to take this from an empty repository to an installed, working app that passes the acceptance run, by planning the work, dispatching parallel sub-agents, integrating their output, and verifying everything yourself.

## Read first
1. `docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md` in full. It is the PRD and the design. Its section 2 lists decisions that are locked; do not reopen them and do not let sub-agents reopen them. Sections 5 to 13 are the design for each subsystem and the delivery plan.
2. `E:\Dev\Yolo\README.md` for the machine, driver and package versions. The reference machine is this one: RTX 5070 Ti, driver 591.86, torch 2.14.0+cu130, ultralytics 8.4.154, Python 3.11.15. Pin the same versions.
3. The reuse list in spec section 14. Read those files before writing replacements for them.

## How to work
- Use the superpowers skills. Brainstorming for this project is complete; do not rerun it at the project level. Use `writing-plans` to turn each sub-project in spec section 13.1 into a plan file under `docs/superpowers/plans/`, `subagent-driven-development` to execute plans with sub-agents, `using-git-worktrees` so each sub-agent works in isolation, `test-driven-development` inside every implementation task, `requesting-code-review` before every merge, and `verification-before-completion` before any claim of done. If a sub-agent finds a gap inside its own sub-project it may brainstorm within that boundary; anything that changes an interface comes back to you.
- Contract first. Wave 0 (spec section 13.2) is you plus at most one sub-agent producing `contract/openapi.yaml`, the generated TypeScript client, the mock server, the repo skeleton, CI, and the two shells. Nothing else starts until Wave 0 is committed and the mock server serves the contract. After that, contract changes happen only through you: edit the spec if needed, edit `openapi.yaml`, regenerate the client, notify affected sub-agents.
- Parallelism. Follow the waves in spec section 13.2. Dispatch every sub-project in a wave at the same time, each in its own worktree and branch, with the plan file, the spec sections it owns, and the contract as its only inputs. Merge in the order the wave's dependencies require. Do not start a wave before the previous wave's integration checkpoint (section 13.4) passes on your machine.
- Model tiers for sub-agents. Contract design, the annotation canvas, and code reviews: the most capable model available. Well-specified implementation tasks with a plan file: a mid-tier model. Mechanical tasks such as lint fixes, docstrings, and generating fixtures: the cheapest tier. You remain the goal owner throughout; do not delegate integration, merging, or verification.
- Verification is yours. After every merge run the backend tests, the frontend tests, and the contract conformance tests. At every checkpoint in section 13.4 run the described flow yourself, on the real app, and record the result in `docs/progress.md` with the commit hash. A sub-agent's report that something works is a claim, not evidence.
- Reporting. Keep `docs/progress.md` current: wave, sub-project, branch, state, blockers, last verified checkpoint. When you stop for any reason, that file must let a new session resume without re-reading the conversation.

## Guardrails
- Never modify anything under `E:\Dev\Yolo` outside `E:\Dev\Yolo\app`. The folder `E:\Dev\Yolo\Ahmadia Construction Data` holds original imagery and is read-only. Copy samples from `E:\Dev\Yolo\data\raw\ahmadia` for tests; never point tests at the originals.
- Secrets: provider API keys go into Windows Credential Manager through the backend's provider endpoint. Never write a key into a file, a test fixture, a log, or a commit. If a live provider test is needed, read the key from an environment variable at runtime and skip the test when it is absent.
- Do not vendor Label Studio source. Use it on GitHub as the interaction reference only. Do not use the Label Studio name in the product.
- Do not install anything system-wide. The backend uses its own virtual environment under `backend/.venv`; the frontend uses local `node_modules`. The Rust toolchain and MSVC build tools for Tauri may be installed if missing, and that is the single exception; say so in `docs/progress.md` when you do it.
- Keep every existing service on this machine untouched: Label Studio on port 8080 and the ML backend on port 9090 belong to a separate workflow. Choose other ports.
- Commit early and often on branches; merge to `main` only after review and verification. Never force-push `main`.

## Definition of done
The goal is complete when all of the following are true and recorded in `docs/progress.md`:
1. `tauri build` produces an installer, and installing it on this machine yields an app that starts in under 15 seconds with the sidecar healthy.
2. The acceptance run in spec section 13.5 passes end to end from the installed app, with each step's evidence (screenshot path or API response excerpt) linked.
3. Backend, frontend and contract test suites pass on `main`.
4. `README.md` in the repo explains how to build, run in development against the mock server and the real backend, and run the tests.

Start with Wave 0. Before dispatching anything, write the S0 plan, show the proposed `openapi.yaml` resource list against spec section 9, and confirm the repo layout matches spec section 3. Then proceed without waiting for further approval unless you hit a decision the spec does not cover, in which case record the question and your chosen default in `docs/progress.md` and continue.
