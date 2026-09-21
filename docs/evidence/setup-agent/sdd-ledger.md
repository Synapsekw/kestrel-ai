# SDD ledger — plan: docs/superpowers/plans/2026-09-21-setup-agent.md

## Rulings
- User explicitly authorized autonomous design, implementation and completion without questions. Apply that over skill approval gates; repo requires main integration and cleanup.
- Model scope is every standard box-detection YOLO architecture supported by installed Ultralytics, 44 variants. Other tasks remain honestly unsupported; do not expose broken selections.
- Preserve existing synchronous bundled import endpoint; add background acquire-starter for setup and model catalogue. Job type import with purpose=starter_model avoids a new enum cascade.
- Chat uses finite request timeout and async UI, not per-project jobs before a project exists; long file/model/label work remains background jobs.

## Preflight interface review
| Tasks | Producer and consumer | Finding |
|---|---|---|
| T1/T2 | Agent chat schemas and backend validation | Bounds/enums matched; semantic whitespace errors use409 so contract fuzz tests remain valid. |
| T1/T3 | Generated client/AgentPlan consumed by UI | Exact fields dispatched to both implementers. Chat output4000 is clipped to2000 in outgoing history. |
| T1/T4 | Starter keys, metadata, acquisition JobRef | All44 keys enumerated; metadata optional for backward-compatible fixtures; backend emits both. |
| T2/T4 | Supported starter key catalog | Reuse CATALOGUE as single runtime authority. |
| T3/T4 | acquireStarterModel returns Job; result.model_id | Confirmed exact signature; separate files owned per agent. |
| T1 | Contract/regeneration/spec | Lint green and generated; no handwritten generated types. |
| T2 | Provider/errors/tests | SDK fake fixtures avoid costs/keys; finite timeout and bounded concurrency. |
| T3 | UI/jobs/tests | Retain created project after subsequent error; estimates invalidated on edits. |
| T4 | Download/cache/tests | Stream and cancel; task validation before registration. |
| T5/T6 | Integration and gates | Controller runs broad gate serially to avoid known job-runner starvation. |

## Progress
- Task 1: complete. Contract lint/generation passed; docs and contract committed.
- T2 complete: agent_backend implemented bounded planner with both SDK adapters and error/security coverage (`8fb1626`).
- T3 complete: agent_frontend implemented retained setup drawer, editable draft, project/import/selection/estimate/label/review and recovery tests (`037ebc2`, `31986da`).
- T4 complete: yolo_catalog implemented 44 starters, streamed acquisition and family/model UI; actual-task and post-success metadata recovery fixed (`ffcb94e`, `dde24b8`, `da2e475`).
- T5 complete: real-backend selected-image integration and browser coverage (`853d838`, `feb3003`); final independent review at da2e475 ready with no blockers.
- T6 gates complete: contract, Ruff, 666 backend, frontend lint/533 unit/build, 59 browser. Rust correctly skipped without frozen sidecar. Merge/cleanup and vault wrapup are the remaining mechanical steps.

## Review resolution
- Actual checkpoint task is checked before starter registration, using the existing metadata load.
- Price estimates cannot revive after edits or provider-setting refreshes.
- Transient polling/model-detail failures preserve the existing acquisition job and model identity; project switching remounts only the local model chooser.
- Created projects remain usable after later steps fail; retry does not duplicate them.

## Evidence
- docs/evidence/setup-agent/README.md and five fixture screenshots.
- Broad gates ran serially. After the logo rebase, backend and contract trees were verified byte-identical and frontend/browser gates rerun against the integrated tree.
