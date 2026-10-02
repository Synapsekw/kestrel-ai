---
type: session
date: 2026-10-02-2300
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-10-02-gotcha-shared-venv-install-while-python-runs]]"]
---

# 2026-10-02-2300-asset-model-builder-m1

## What changed

- **Feasibility:** the operator's Cowork-built HCl tank mission viewer (`C:\Users\D\Downloads\source_2`) was reviewed for porting into Kestrel. It was made of bespoke scripts with the tank's dimensions hard-coded. The port became programme M1–M6.
- **Spec:** `d8713b07` added `docs/superpowers/specs/2026-10-02-asset-model-builder-design.md`, with the M1–M6 programme and the M1 design. Its decisions:
  - The agent emits a structured part spec, and app code builds the GLB. No AI-written code runs.
  - Inputs are any mix of drawings, clouds and photos.
  - The agent can be Claude, OpenAI or Gemini.
- **Plan:** `1b392b1a` added an index plus seven unit plans (`docs/superpowers/plans/2026-10-02-asset-model-*.md`), and folded the planning amendments into the spec (§13).
- **Build:** one opus controller per unit ran SDD in its own worktree. I merged them one at a time with `--no-ff` through `am-int`:
  - `6e439c0b` U1: model spec, 12 shapes, placement, validation, GLB builder; adds trimesh 4.12.2 and mapbox-earcut 1.0.3.
  - `6106cb9c` U4: drawing view and text, the bounded cloud sample, slice and fit, photo view.
  - `ccc13c34` U2: numpy rasterizer and per-part comparison against a scan.
  - `740ce719` U3: the full M1 contract, migration 0015, the models and versions API, the GLB job, and the asset model data item.
  - `b43673af` U5: Gemini in `llm.complete`; `KeyedProviderName`; Anthropic default `claude-opus-5-5`; the agent's tools; the `asset_model_run` job with budgets, stop, drafts and restart sweep; the runs API. Also `894189a2`, which bounds the `version` and `step` path ints.
  - `ee01df5c` U6: the Asset models workspace (GLB viewer, Parts/Part/Versions, edit-as-new-version, downloads).
  - `914c4d5b` U7: the Build dialog, live run bar, Run tab, e2e, and `docs/evidence/2026-10-02-asset-model-m1/walkthrough.md`.
- **Tests:** each unit's own full gate was green.
  - Last full gate, U7 at `02c04893`: pytest 5462 passed, vitest 4201, e2e 184, ruff, contract check.
  - Each merge gate (contract, ruff, asset-model + contract + migration tests, lint, build, and vitest for U5–U7) was green.
  - The frozen sidecar built from `914c4d5b` passes `smoke_frozen.ps1`, including `asset-models ok 576 12092`.
- **Shared venv:** U5's pins were installed non-additively: google-genai 1.75.0 plus its dependencies; websockets 17.1 → 16.1.1; requests 2.28.1 → 2.34.2; certifi → 2026.7.22. A snapshot was taken first (`.superpowers/sdd/am-common/shared-venv-before-u5.txt`).

## Why

The operator wants the Cowork artifact's capabilities inside the app and testable stage by stage. M1, building a dimensioned GLB of the asset from its drawings, scans and photos, is the prerequisite: flights, findings and reports all anchor to that model.

## Open threads

- **Installer not built.** `pnpm build:installer` stopped at `check-packaged-webview.ps1`: "Kestrel AI is running; close it first". The frozen backend at `914c4d5b` is already in `frontend/src-tauri/binaries`. Close the app, run `pnpm -C frontend build:installer`, and install.
- **Acceptance not run (spec §11).** It needs the HCl GA drawing P-00212-DW-MD-143TD1 rev 3, put in `backend/tests/data/asset_models/hcl-tank-ga.pdf` (git-ignored) and imported as a Drawing. An Anthropic key is already stored on this machine. The ±2° bearing and ±25 mm elevation checks in `test_asset_model_live.py` still need the expected values transcribed from `source_2/model_meta.json`.
- **Gemini default model id** `gemini-2.5-pro` is unconfirmed. It needs one live test from App settings → Providers → Google Gemini → Test, and can be edited there.
- **DXF and LandXML drawings have no `plan.tif`.** The agent can read DXF text but can't view either as an image (U4 ruling).
- **Deferred minors** are in the per-unit ledgers at `.superpowers/sdd/am-common/ledgers/am-u*.md` (git-ignored). The final reviews triaged them all as fine to merge. Notable ones:
  - compare is unsigned distance;
  - the iso view hides the north and east sides;
  - the 2 000-part `validate` takes about 8 s synchronously;
  - unsaved Part edits are dropped silently;
  - the frontend `MAX_STEPS = 80` must track the backend `MAX_CALLS`.
- The other session's artifact-port plan (`docs/artifact-to-kestrel-plan.md`, untracked) treats M1 as its P0, and its P1 absorbs M4.

## How to test

1. Close Kestrel AI, run `pnpm -C frontend build:installer`, and install the new setup exe.
2. Settings → Providers: check that Anthropic reads `claude-opus-5-5` and that a Google Gemini row exists. Add a Gemini key and press Test.
3. Follow `docs/evidence/2026-10-02-asset-model-m1/walkthrough.md`:
   1. Asset models → New asset model.
   2. Build with AI, picking the GA drawing and Anthropic, and watch the bar and the Run tab until "Built version 1".
   3. Use Cut, Levels, Head off and the group switches.
   4. Edit N7's projection and save it as a new version.
   5. Compare and restore versions.
   6. Download the GLB and the JSON spec.
   7. Stop a run; a draft is saved.
   8. Close the app during a run and reopen it; the run reads "Interrupted when the app closed".
4. Acceptance: compare the built HCl spec with spec §11 (ID 4000 ± 5, shell 8000 ± 5, three courses, 17 nozzles and manways), or run `pytest -m live tests/test_asset_model_live.py` with the drawing in place and `ANTHROPIC_API_KEY` set.

## Next session entry point

Build and install the installer from `main` (`914c4d5b` or later), then run the M1 walkthrough with the HCl drawing. After acceptance, brainstorm M2 (Elios mission import), in coordination with the other session's artifact-port P1.
