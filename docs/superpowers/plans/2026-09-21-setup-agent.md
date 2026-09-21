# Setup agent implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development task-by-task, with independent review before integration.

**Goal:** Ship conversational project setup, first labeling, and the complete supported YOLO detection catalog.

**Architecture:** Typed cloud planning supplies an editable draft. The drawer orchestrates existing project/import/inference actions and background jobs. An allow-listed YOLO catalog acquires weights lazily.

**Tech stack:** Existing FastAPI/Pydantic/SQLAlchemy, OpenAI/Anthropic SDKs, React/TypeScript/Zustand, Contour UI; no new runtime dependencies.

**Spec:** docs/superpowers/specs/2026-09-21-setup-agent-design.md

## Global constraints and budget

- Work only in task/setup-agent worktree; main is integration home. Stage explicit paths.
- Credential Manager is the only key store; sanitized failures, no new raw provider logs.
- Contract is source of truth, generated schema committed together.
- Chat max 12 x 2,000-character messages, 32 classes, 4,000 output tokens, 45s timeout.
- Image metadata pages and selected first-label batch max 24. No automatic full-set reads.
- Import, model acquisition, labeling, dataset generation, train and export are background jobs.
- User delegated all decisions and authorized completion/merge under repository agreement.

## DAG and ownership

T1 contracts/spec -> parallel T2 backend planner + T3 frontend setup + T4 catalog -> T5 integration/browser/review -> T6 gates/merge/wrapup. T4 research can precede T1; T3 consumes the centrally generated client and T4 acquireStarterModel function. Critical path T1 -> T2/T3 -> T5 -> T6.

### T1: Contracts and planning (controller)
- [x] Add bounded AgentMessage, AgentPlan, AgentChatRequest, AgentChatResponse and chat endpoint.
- [x] Expand StarterModelKey and add acquire-starter endpoint and catalog metadata.
- [x] Generate client and run contract lint; commit contract with specs.

### T2: Backend planner (backend implementer)
Files: backend/app/agent/{schemas,service,router}.py, backend/app/api.py, backend/tests/test_agent*.py.
- [x] Write failing tests for input/auth/provider cases.
- [x] Implement constrained SDK adapters and response validation against catalog.
- [x] Run focused tests, ruff, self-review and commit owned files.

### T3: Frontend setup drawer (UI implementer)
Files: frontend/src/agent/*, frontend/src/api/agent.ts, shell/header integration, relevant tests.
- [x] Read DESIGN.md and shared UI, test user flows before implementation.
- [x] Build chat, editable plan, project create, model acquire, image import and bounded image selection.
- [x] Add estimate/start/progress/review, recovery and accessible drawer behavior.
- [x] Run focused tests/lint; self-review and commit owned files.

### T4: YOLO catalog (catalog implementer)
Files: backend/app/training/starter*, related schemas/tests; frontend model selection/API/tests.
- [x] Verify official documentation and installed runtime models.
- [x] Test full supported catalog and lazy acquisition failures/cancellation/task validation.
- [x] Implement streaming background download with safe allow-listed asset names and atomic cache.
- [x] Replace limited model choices with family/model selectors; focused tests and commit.

### T5: Integration and independent review (controller + reviewer)
- [x] Verify real backend boundaries and full UI workflow using deterministic provider responses and generated fixture images.
- [x] Browser inspect drawer at laptop/narrow sizes, keyboard/focus behavior and error states.
- [x] Independent whole-branch review; resolve material findings and retest affected flows.

### T6: Gates, integration and memory (controller)
- [x] Run contract check, backend ruff/pytest, frontend lint/test/build; conditional cargo gate.
- [ ] Record results and limitations in docs/progress.md; update vault via /wrapup checklist.
- [ ] Commit explicit owned paths, merge to main, safely remove task worktree and delete branch.
- [ ] Give numbered operator walkthrough and mark goal complete only when all work is done.
