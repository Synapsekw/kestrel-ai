---
type: adr
date: 2026-09-20
status: accepted
tags: [decision]
related: []
---

# Rename to Kestrel AI

## Context

"machinery" has two roles in this repo: the product identifier (`machinery-app`,
`Machinery Detection`, `machinery-backend`, ...) and the domain noun for the construction
machinery the model detects (`"No machinery (N)"`, `marked_empty`, `empties.py`, ...). Only the
first is being renamed. A reader hitting `machinery-backend` in an old review diff needs to be
able to resolve which one it was — a repo-wide find-and-replace would have corrupted the domain
noun (rewriting the empty-marking toolbar, endpoint summaries, and `marked_empty` semantics), so
the rename is enumerated by file, not swept.

## Decision

Rename the product identifier only, per this map (`docs/superpowers/specs/2026-09-20-kestrel-ai-rename-design.md` §2.1):

| Old | New |
| --- | --- |
| `Machinery Detection` (display name) | `Kestrel AI` |
| `machinery-app` (identifier slug) | `kestrel-ai` |
| `ai.synapse-solutions.machinery-app` (Tauri identifier) | `ai.synapse-solutions.kestrel-ai` |
| `machinery-backend` (sidecar exe, FastAPI title, pyproject name) | `kestrel-backend` |
| `machinery_backend.spec` | `kestrel_backend.spec` |
| `machinery-app.exe` (Rust binary) | `kestrel-ai.exe` |
| `machinery_app_lib` (Rust lib crate) | `kestrel_ai_lib` |
| `@machinery-app/contract` | `@kestrel-ai/contract` |
| `machinery-detection.iss` | `kestrel-ai.iss` |
| keyring `SERVICE = "machinery-app"` | `kestrel-ai` |
| `machinery-logfile-` (Rust test temp prefix) | `kestrel-logfile-` |
| Brand wordmark `Machinery` | `Kestrel AI` |

The Inno Setup `AppId` GUID `{B7E0B1F4-4C2E-4D6D-9C3A-2F5E6A1D9C77}` does not change.

## Rationale

An enumerated, file-by-file map is the only way to rename the product identifier without also
rewriting the unrelated domain noun that happens to share the same word.

## Consequences

- Positive: product identifiers are consistent with the new name; the domain noun ("machinery"
  the equipment) is untouched everywhere it matters (UI copy, contract summaries, model
  semantics).
- Negative: two deliberate survivals of the old name remain in migration code and must not be
  "cleaned up": `LEGACY_SERVICE = "machinery-app"` in `backend/app/providers/keys.py` (reads the
  operator's pre-rename stored API keys) and the legacy folder name
  `ai.synapse-solutions.machinery-app` in `frontend/src-tauri/src/lib.rs` (migrates the pre-rename
  app-data folder).
- Open follow-ups: none.

## Related

-
