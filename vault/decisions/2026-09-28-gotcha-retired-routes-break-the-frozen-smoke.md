# Gotcha: retiring a route silently breaks `smoke_frozen.ps1`

**Date:** 2026-09-28 · **Status:** accepted

## Context
I-FW retired `POST /images/{imageId}/preannotate` (replaced by I-BP's `detectImage`). Every unit gate
passed, and the full gate at IMC-X passed too, yet the first frozen smoke run of the wave stopped with a
404 at its `predict` step.

## Cause
`backend/scripts/smoke_frozen.ps1` calls the API by literal paths, and it only runs when someone
freezes the sidecar (packaging work, a programme close-out). No pytest, vitest or e2e reads the
script, so a route rename or retirement is invisible to the gate until the next packaging run.

## Decision
IMC-X pointed the smoke's `predict` step at `POST /images/{imageId}/detect`
(`predict ok <n> boxes <device>`). A unit that retires or renames an operation greps
`backend/scripts/*.ps1` and `frontend/scripts/*` for its path in the same change.

## Consequence
Packaging scripts are part of the contract surface. Expect this class of break whenever a wave
retires routes and nobody freezes the sidecar until the end.
