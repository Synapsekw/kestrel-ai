---
type: adr
date: 2026-09-27
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-27-2140-imc-wave-part-1]]"]
---

# An emptied `{ ... }` set in `test_contract.py` becomes a dict

## Context

In the I/M/C wave, every unit deleted its own stub names from shared lists in `backend/tests/test_contract.py`,
such as `EXPECTED_STUBS: set[str] = {...}`. The coordinator resolved these merge conflicts automatically:
a line survives only if neither side deleted it. When I-BP merged, the last Images stub names went, and the
block was left as

```python
EXPECTED_STUBS: set[str] = {
    # Images (plan 2026-09-27-images-c0): each unit deletes its lines when it lands them.
}
```

That is an empty **dict**, not a set: `{}` with only a comment inside is a dict literal, and the annotation
does not change that. The merge gate failed with `TypeError: unsupported operand type(s) for &: 'set' and 'dict'`
in `test_stub_list_matches_routers` and `test_transition_allowances_name_real_operations`.

## Decision

When the last entry of a set literal is removed, write `set()` (`63034aa`). Anyone emptying a set by hand or by
tool does the same.

## Rationale

Ruff and the type annotation don't catch this, and the file still imports. It only fails when a set operator
runs, which here is in the merge gate's contract tests, several minutes into the run.

## Consequences

- Positive: the fix is one line and the contract tests pin it.
- Negative: the same trap is waiting in the other shared `{...}` stub sets (the Point clouds block and Maps'
  lists) as their last units land.
- Open follow-ups: `resolve_lists.py` could rewrite an emptied `set[...] = {` block to `set()` itself.

## Related

- [[2026-09-27-2140-imc-wave-part-1]]
