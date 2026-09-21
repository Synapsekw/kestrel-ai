# Contour desktop rebuild

User request: rebuild the installed desktop app with the approved Contour interface.

## Scope and budget

Rebuild application source at `54b5e299df2ba89b9c813ce0aef1d66fe7c40773` in
`.claude/worktrees/contour-desktop`, package a freshly frozen backend, update the per-user
installation, and verify the installed executable. No application behavior or contract changes.
Reuse the already-passed source gates from the preceding Contour block only while the application
trees remain identical; run fresh frozen-backend, Rust, release-build and installed-app checks.

Verification uses a separate disposable project with three local sample images. Imports,
training and exports remain background jobs with progress. Frozen training is one epoch in a
single training job; reads and image counts stay bounded. No paid provider requests or operator project
edits. Runtime authentication stays in memory and is excluded from evidence.

## Execution DAG

1. Isolated checkout + dependencies + starter weights → fresh frozen backend.
2. After freeze, independent units: frozen GPU smoke; Rust tests followed by release packaging.
3. Both passing → retain installer outside worktree → update installed app.
4. Installed executable → startup/GPU health, Contour screens and interactions, close/relaunch.
5. Evidence + exact source comparison → integration and worktree cleanup → vault wrapup.

Critical path: freeze → release packaging → installation → native verification. GPU smoke runs
separately from other GPU workloads. Cargo commands run sequentially to avoid build-directory
contention.

## Completion evidence

See `docs/evidence/ui/2026-09-21-contour-installed/README.md` for the completed checks,
artifact identity, actual native screenshots, limitations and operator walkthrough.
