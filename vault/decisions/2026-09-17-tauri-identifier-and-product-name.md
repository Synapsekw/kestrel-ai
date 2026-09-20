---
type: adr
date: 2026-09-17
status: accepted
tags: [decision]
related: ["[[2026-09-20-decision-rename-to-kestrel-ai]]"]
---

# Tauri identifier and product name

## Context

The Tauri app needs a bundle identifier and a product name; the identifier drives where the
packaged app stores its data (`%APPDATA%\<identifier>`).

## Decision

Tauri identifier `ai.synapse-solutions.kestrel-ai`, product name "Kestrel AI".

## Rationale

Namespaced under the `ai.synapse-solutions` reverse-domain, matching the product's current name.

## Consequences

- Positive: identifier and display name are consistent with the product name in use today.
- Negative: because the identifier is app-data-derived, any future rename of it requires a data
  migration (see the rename ADR).
- Open follow-ups: none.

Originally chosen as `ai.synapse-solutions.machinery-app` / "Machinery Detection" on this date;
renamed to the current value on 2026-09-20 — see
[[2026-09-20-decision-rename-to-kestrel-ai]].

## Related

- [[2026-09-20-decision-rename-to-kestrel-ai]]
