---
type: adr
date: 2026-09-26
status: accepted
tags: [decision, gotcha, contract]
related: ["[[2026-09-26-foundation-contract-lands-before-its-backend]]"]
---

# Gotcha: a comma in a YAML flow mapping splits a description into an extra key

## Context

`contract/openapi.yaml` writes most properties as flow mappings:
`name: { type: string, description: absolute path; created when missing, must not already hold a project }`.
In a flow mapping a comma ends the entry, so YAML reads that as `description: "absolute path;
created when missing"` plus a second key, `must not already hold a project`, with a null value.
OpenAPI 3.1 schemas are JSON Schema, where unknown keywords are allowed, so Spectral reports
nothing, openapi-typescript ignores it, and the description is silently cut. Planning the
foundation contract found about two dozen such cut descriptions in the contract (for example
`SourceCreate.site`, `Image.path`, `LibraryModel.train_gsd_cm`, `PointCloudOut.source_path`), and
the foundation's own first draft added ten more.

## Decision

In a flow mapping, a `description` (or any scalar) that contains a comma or `": "` is
double-quoted. Block style (`description: >-` on its own lines) needs no quotes.

## Rationale

The failure is invisible to every tool in the gate; only reading the parsed YAML shows it. Quoting
is the one rule that makes it impossible.

## Consequences

- Positive: new contract text keeps its whole description.
- Negative: the existing cut descriptions stay until someone touches those schemas; a one-off scan
  (walk the parsed `components.schemas` and list keys that are not JSON Schema keywords) finds them.
- Open follow-ups: a Spectral custom rule could flag unknown schema keywords.

## Related

- [[2026-09-26-foundation-contract-lands-before-its-backend]]
