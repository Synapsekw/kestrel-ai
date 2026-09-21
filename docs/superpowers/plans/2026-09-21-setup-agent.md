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
- [ ] Add bounded AgentMessage, AgentPlan, AgentChatRequest, AgentChatResponse and chat endpoint.
- [ ] Expand StarterModelKey and add acquire-starter endpoint and catalog metadata.
- [ ] Generate client and run contract lint; commit contract with specs.

### T2: Backend planner (backend implementer)
Files: backend/app/agent/{schemas,service,router}.py, backend/app/api.py, backend/tests/test_agent*.py.
- [ ] Write failing tests for input/auth/provider cases.
- [ ] Implement constrained SDK adapters and response validation against catalog.
- [ ] Run focused tests, ruff, self-review and commit owned files.

### T3: Frontend setup drawer (UI implementer)
Files: frontend/src/agent/*, frontend/src/api/agent.ts, shell/header integration, relevant tests.
- [ ] Read DESIGN.md and shared UI, test user flows before implementation.
- [ ] Build chat, editable plan, project create, model acquire, image import and bounded image selection.
- [ ] Add estimate/start/progress/review, recovery and accessible drawer behavior.
- [ ] Run focused tests/lint; self-review and commit owned files.

### T4: YOLO catalog (catalog implementer)
Files: backend/app/training/starter*, related schemas/tests; frontend model selection/API/tests.
- [ ] Verify official documentation and installed runtime models.
- [ ] Test full supported catalog and lazy acquisition failures/cancellation/task validation.
- [ ] Implement streaming background download with safe allow-listed asset names and atomic cache.
- [ ] Replace limited model choices with family/model selectors; focused tests and commit.

### T5: Integration and independent review (controller + reviewer)
- [ ] Verify real backend boundaries and full UI workflow using deterministic provider responses and generated fixture images.
- [ ] Browser inspect drawer at laptop/narrow sizes, keyboard/focus behavior and error states.
- [ ] Independent whole-branch review; resolve material findings and retest affected flows.

### T6: Gates, integration and memory (controller)
- [ ] Run contract check, backend ruff/pytest, frontend lint/test/build; conditional cargo gate.
- [ ] Record results and limitations in docs/progress.md; update vault via /wrapup checklist.
- [ ] Commit explicit owned paths, merge to main, safely remove task worktree and delete branch.
- [ ] Give numbered operator walkthrough and mark goal complete only when all work is done.
