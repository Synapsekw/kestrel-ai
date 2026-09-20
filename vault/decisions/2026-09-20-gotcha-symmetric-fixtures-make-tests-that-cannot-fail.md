---
type: adr
date: 2026-09-20
status: accepted
tags: [decision, gotcha]
related: ["[[2026-09-20-1814-rotated-boxes-wave-1]]"]
---

# Gotcha: symmetric fixtures produce tests that cannot fail

## Context

Three separate tests written during the rotated-boxes wave passed against implementations that were
wrong, or would have passed against a full revert of the feature they named. Each was caught in
review, but two of them were written *after* the first had already been caught — so this is a
pattern, not three accidents.

**1. A tautology.** `test_aabb_always_contains_every_corner` asserted that `aabb_of`'s result
contains the points `corners_of` returns. But `aabb_of` *is* min/max over that same `corners_of`
call, so the property holds for any deterministic implementation, correct or not.

**2. A one-sided bound.** The canvas label test asserted only `label.y < box.y` for a box at 90°.
The corner-anchored label lands at `(627, 261)`; the *pre-feature* anchor lands at `(512, 286)` —
and `286 < 300` passes. A complete revert of the anchoring logic passed the test. It never asserted
`x`, which is where the difference is 115 px.

**3. A symmetric angle.** The COCO test asserted `area == w * h` for a 30x40 box at **90°**. At a
right angle the axis-aligned envelope is the box with its sides swapped — `(40, 30)` — so envelope
area and box area are both 1200, *identically*. The assertion passed whether the code used
`box.w * box.h` (correct) or the envelope's area (the exact defect the test was written to catch).
At 30° on a 60x20 box the two diverge: 1200 against 2932.

The common cause is the same in all three: the fixture was chosen to be easy to reason about by
hand — 0°, 90°, a square — and those are precisely the configurations where a wrong answer and a
right answer coincide.

## Decision

For any test of rotation, projection, or a symmetric transform:

1. **Pick an asymmetric fixture.** A non-right angle (30°, 37°) and unequal sides. If the expected
   value is easy to compute in your head, the test probably cannot distinguish much.
2. **Assert the discriminating coordinate**, not a bound that both the right and wrong answer
   satisfy. Prefer exact values over inequalities.
3. **Prove the test can fail before trusting it** — revert the fix, watch it go red, restore, watch
   it go green, and record both outputs. A test written to catch a regression should be demonstrated
   catching it.
4. **Generate expected values from the implementation, then verify the implementation separately.**
   Hand-typed expectations that merely agree with the code prove nothing.

Point 4 has a sharp edge worth stating: `contract/fixtures/oriented-boxes.json` was generated *from*
`backend/app/geometry.py`. It therefore pins TypeScript to Python and catches **divergence**, never
**shared error** — if the Python handedness were wrong, the fixture would encode the wrong answer
and both languages would agree on it forever. What actually guarantees the Python side is a pair of
tests that provably fail under a mirrored implementation
(`test_corners_at_ninety_degrees_pin_the_rotation_direction`, which asserts ordered corners, and
`test_the_top_edge_tilts_downward_to_the_right`). A cross-language fixture is not a correctness
test; it is a drift test.

## Rationale

The alternative — trusting a green suite — is what shipped all three. Every one was caught by a
reader asking "would this fail if the feature were removed?", not by the suite.

The cost is small: an asymmetric fixture is no harder to write once the expected values are
generated rather than derived by hand, and the mutation check is two commands.

## Consequences

- Positive: three assertions in this wave now genuinely guard their behaviour, and the handedness of
  the rotation maths is pinned in both languages.
- Negative: mutation checks temporarily revert production code. Every one in this wave was confirmed
  restored via `git diff --stat`, but a forgotten restore at a merge gate would be the worst possible
  outcome — always verify the restore explicitly.
- Open follow-ups: the wave-2 plan should specify asymmetric fixtures by default. `BoxLayer.test.tsx`
  mocks react-konva wholesale, so `commit()` — the centre-pivot transform — has no unit coverage at
  all and cannot get any without a real stage; it is covered only by the operator walkthrough.

## Related

- [[2026-09-20-1814-rotated-boxes-wave-1]] — commits `2fe22e7`, `633b41a`, `c80d319`
- `contract/fixtures/oriented-boxes.json`, `backend/tests/test_geometry.py`
