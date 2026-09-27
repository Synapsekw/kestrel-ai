---
type: adr
date: 2026-09-27
status: accepted
tags: [decision, gotcha, backend]
related: ["[[2026-09-27-new-options-on-existing-operations-answer-501]]"]
---

# Gotcha: ruff format collapses a one-element tuple with a trailing comma onto one line

## Context

`backend/app/api.py` loads the map workspace's router with a `for _module in (...):` block, the
same pattern used for the pointcloud/surfaces/volumes routers above it. With a single element,
`for _module in ("app.workspace.stubs",):` is syntactically identical whether it is written on one
line or split across several, and `ruff format` prefers the one-line form whenever the content fits
under the line-length limit. But the plan tells every later M unit to insert its own router module
"on its own line above `"app.workspace.stubs",`" inside this block — an instruction that only makes
sense if the tuple stays multi-line between now and when the first M unit lands. If `ruff format`
folds it back onto one line, the next unit's diff either fights the formatter or inserts its line
in a place `ruff format --check` then rejects.

## Decision

Put a comment inside the tuple, between the opening `(` and the element:

```python
for _module in (
    # each M unit inserts its router module on its own line above this one
    "app.workspace.stubs",
):
```

A comment line forces `ruff format` to keep the tuple split (it cannot join a comment onto the
same line as code), so the block stays multi-line and ready for the next unit's one-line insert.

## Rationale

Any other fix (a trailing no-op element, a `# fmt: off` pragma, a two-element tuple with a dummy
placeholder) either changes runtime behaviour or requires every later unit to remember to remove
scaffolding. A comment costs nothing at runtime, documents the insertion point for the next unit,
and is the one thing `ruff format` will not collapse.

## Consequences

- Positive: `ruff format --check` stays green with the tuple split across lines from this commit
  on; each M unit's diff is a clean one-line insert above the comment.
- Negative: none noticed; the comment is slightly redundant with the block comment above it, kept
  anyway because it sits at the exact insertion point.

## Related

- [[2026-09-27-new-options-on-existing-operations-answer-501]]
