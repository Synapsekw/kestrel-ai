# Kestrel A identity implementation plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the implementation and review.

**Goal:** Apply the approved A / Kestrel bird consistently inside the app and to the desktop and installer, then rebuild and install.

**Architecture:** One flat SVG bird master feeds the React Brand component and an icon-generation command. The existing Tauri/Inno paths continue to consume regenerated native icon files. No application workflow changes.

**Tech stack:** Existing React/TypeScript/Vite, Tauri CLI icon generator, Node built-ins, Windows Inno Setup.

**Approved design:** User selected A in this conversation, then explicitly requested implementation and rebuild. Reference: `C:/Users/D/.codex/generated_images/01a0c43b-ec9a-7c83-ae7c-56d9b4b3bbe4/exec-c7856739-9466-4671-ab96-59b2506ccb0d.png`, left column. Swept symmetric wings, small central head, diamond tail, deliberate negative-space feather cuts. Flat charcoal bird on Contour amber; no glow or gradient.

## Global constraints and budget

- Preserve the product name, accessible branding, rail geometry and existing workflows.
- No new runtime dependencies, backend edits, contract edits, remote assets or provider calls.
- Logo assets are local, bounded static files. No new API reads/jobs. Existing training, import,
  inference and export remain background jobs; verification uses three images and one training epoch.
- The final drawing is a vector refinement of the chosen concept; the raster presentation is not
  shipped. Native icon sizes must include useful 16/24/32/48/64/128/256 coverage as applicable.
- Scope excludes the separately logged class-settings layout issue.

## Execution DAG

Parallel batch: controller refines the SVG master and freezes the backend; one implementer integrates
Brand and deterministic native-asset generation against the agreed master path. Then asset generation
and visual proof → task review → gates and final review → release packaging → installation/native
verification → evidence, merge/cleanup and wrapup. Cargo operations are sequential. Only one backend
test/training workload runs at a time. Critical path: approved master → icons → release → installation.

### Task 1: Consistent app and native identity

**Owned by implementer:** `frontend/src/app/Brand.tsx`, `frontend/scripts/generate-icons.mjs`,
`frontend/package.json`, generated `frontend/src-tauri/icons/*`, focused verification under
`frontend/scripts/` or `frontend/e2e/`, and icon-generation documentation in `DESIGN.md`.

**Controller-owned input:** `frontend/src/assets/kestrel-mark.svg` is the only source of bird geometry.
It is a complete square 256×256 SVG with flat charcoal #1d2322 paths and a transparent background.
The controller supplies this while implementation proceeds; do not edit it or invent a second bird.

- [x] Read DESIGN.md and the existing Brand/icon/installer configuration. Run the existing Sidebar
  test as the baseline. Keep the accessible Kestrel AI text exactly once, including compact mode.
- [x] Implement a reusable developer command `pnpm -C frontend icons:generate`: consume the SVG
  master, place it with generous padding on an amber #e5af64 rounded square and use the installed
  Tauri CLI to generate PNG/ICO/ICNS assets. Preserve and regenerate every currently tracked native
  icon filename. The small 16/32px native sizes must remain recognizable.
- [x] Provide meaningful automated validation of native asset freshness/coverage or real image
  loading; first demonstrate failure against old/missing assets, then success after generation.
  Do not add tautological assertions over hardcoded SVG paths or trivial snapshot tests.
- [x] Use the master in Brand as a decorative local image. The tile remains amber; size the bird
  generously inside the existing 28px/36px tiles (roughly 22px/28px image). Preserve name visibility,
  screen-reader name, and existing props. No animation or unrelated UI changes.
- [x] Reuse existing compiler/installer icon references when they already point at regenerated
  `icon.ico`; document setup, uninstaller and shortcut coverage. Add no unneeded platform assets.
- [x] Run focused verification and frontend lint. Stage only owned paths, commit and self-review.
  Report design/source integration concerns to the controller; no subagents or global gate runs.

### Task 2: Review, rebuild, install, and verify

**Controller-owned:** source master, plan/ledger/evidence, backend freeze, full required gates,
release/installer build, installed-app verification, integration and dev-memory wrapup.

- [x] Inspect icon proof at small and large sizes and actual compact/expanded branding; confirm Splash shares Brand.
- [x] Independent task review and final review. Run contract check, Ruff, pytest, frontend lint,
  tests/build and Rust tests with frozen sidecar present; record actual results.
- [x] Build and smoke the backend, compile native release + installer, retain artifact outside worktree.
- [x] Check running app for active work before closing for the authorized update. Install silently;
  prove installed hashes equal the new build and extracted native app/installer icons show the bird.
- [x] Verify actual installed WebView branding and startup/healthy GPU, along with editor smoke.
  Reopen the installed app, record evidence and operator walkthrough, merge/push and clean worktree.
