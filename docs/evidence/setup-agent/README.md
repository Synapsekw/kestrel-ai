# Setup agent and YOLO catalog verification

Date: 2026-09-21. Scope: source/build and browser integration, with deterministic cloud responses.

## What was built

- Global Setup agent drawer uses configured OpenAI or Anthropic model/key for bounded, structured planning.
- Editable name, classes and starter selection create an ordinary local project, then acquire starter weights in a background job.
- Image import, paged thumbnails (24 per request), selection (24 maximum), cost estimate, first labeling, cancellation/resume and review navigation.
- Draft state remains while closing/navigating in the same app session. Actual projects, imports, models and jobs are persisted by existing backend services.
- 44 standard detection checkpoint variants across YOLO26, 12, 11, v10, v9, v8, v5u and v3u. Other task types are explicitly outside this detection workflow.

## Verification evidence

- Backend Ruff passed. Full pytest: **666 passed, 9 deselected**, 196.94s. The excluded tests are the repository's GPU/live-provider markers.
- Contract check (Spectral lint, regeneration, generated-client diff) passed. Contract conformance: **63 passed**.
- Frontend lint passed (ESLint, formatting and design tokens); **533 tests across 124 files passed** and the TypeScript/Vite production build passed. Vite reports the existing large-chunk advisory.
- Full Playwright suite: **59 passed in 22.5s**, including both setup-agent flows and the expanded Models flow. Screenshots were refreshed after rebasing onto the newly merged Kestrel identity.
- Conditional Rust gate skipped as required by CONTRIBUTING: this worktree has no frozen `kestrel-backend-*.exe`. No Rust source or packaging configuration changed.
- `backend/tests/test_setup_workflow.py` uses real project creation, JPEG import, background inference jobs and persisted boxes. Only paid planner/vision calls are replaced; exactly the selected two of three images receive unreviewed class-matched boxes.
- Provider tests cover both SDK request shapes, configured models, credentials, roles, bounds, invalid drafts, refused/oversized/incomplete responses, errors, timeout and concurrency slots. No user credentials were read for tests.
- Catalog tests cover cache/bundle reuse, one-model streamed downloads, cancellation/truncation/size limits, atomic publication and checking the actual loaded checkpoint task before registration.
- Browser walkthrough: chat -> editable plan -> created project -> import -> bounded image selection -> estimate -> first labeling -> review; close/reopen and narrow viewport missing-key recovery.
- Browser model walkthrough: eight family choices, a non-YOLO11 selection and acquisition of only that selection.
- Review fixed actual task validation, stale estimate revival, duplicate imports after progress failures, and retained project state.
- Final independent review at `da2e475`: ready subject to final gates, no remaining concrete blockers. All gates above are now complete. Backend/contract trees were identical across the logo-only rebase; frontend lint, unit tests, build and all browser tests ran afterward.

## Screenshots and fixtures

`project-plan.png`, `image-selection.png`, `first-labeling.png`, `missing-key.png` and
`yolo-families.png` were captured by `frontend/e2e/setup-agent.spec.ts` and `models.spec.ts`.
They show synthetic API/image fixtures, not user projects or actual AI accuracy. Existing Home
screen background responses may use Prism examples. Animations are disabled for stable captures.

## Model and API references

Catalog keys were cross-checked against installed Ultralytics **8.4.154** and all 44 checkpoint
filenames exist in the [official v8.4.0 release metadata](https://api.github.com/repos/ultralytics/assets/releases/tags/v8.4.0).
Largest catalog asset: 297.5 MB. This was a metadata check, not 44 downloads or training benchmarks.
Model scope follows the [Ultralytics model documentation](https://docs.ultralytics.com/models/).

Planner request formats follow [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
and [Claude structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).
Local validation enforces bounds excluded from the shared provider schema.

## Operator walkthrough

1. Run the updated application from this checkout. Open **Setup agent** in the header or **Plan with the setup agent** on Projects.
2. Choose GPT or Claude with a stored key. Describe a detector, for example cranes and trucks in aerial site photos. Check the suggested name/classes, choose a YOLO starter, choose a new project folder, then **Create project**.
3. Choose an image folder and **Import images**. Model acquisition and import show real progress and may be cancelled/retried. Closing the drawer preserves the session and jobs.
4. Select a few representative thumbnails, check the labeling instructions, and **Estimate first labeling**. Review the approximate charge, then **Start first labeling**.
5. When finished, **Review suggestions**. Accept/edit/reject before building a training dataset. Suggestions are never automatically accepted.
6. Open **Models**, choose another **Model family** and **Starter model**, then **Download and add**. The registered model becomes available as a training base; only its weights are fetched.

## Limits of this evidence

No paid live-provider calls or user-image uploads were made. GPU training accuracy for every
catalog model is not claimed. This task changes application source; a replacement Windows
installer is not part of these verification results.
