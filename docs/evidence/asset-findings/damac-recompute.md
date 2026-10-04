# DAMAC recompute acceptance (X Step 3): PASS against the amended targets (operator ruling)

## Operator ruling: kind targets amended for the spec's rectangle = pin rule

Spec §6.3 keeps its mixed rule: a polygon gives a patch and a rectangle gives a pin. The kit made patches for
some rectangle findings, so the recompute's kind counts and same-kind share are judged against the spec rule,
not the kit. No code changed.

The rule difference is fully accounted for:
- 27 kit patches on plain-rectangle sightings become points under the spec rule;
- 2 kit patches become none: `asset_place` finds no placement for them. I did not diagnose why; the operator ruling accepts it.

Amended targets:
- patch, point and none counts each within 2% of the replay once these rule changes are applied (patch 715 - 29 = 686, point 625 + 27 = 652, none 101 + 2 = 103);
- at least 98% of the sightings that the rule does not move keep the same kind.

| Measure | Amended target | Got | |
| --- | --- | --- | --- |
| Patch | 686 within 2% | 686 | ok |
| Point | 652 within 2% | 652 | ok |
| None | 103 within 2% | 103 | ok |
| Same kind among the 1,412 the rule does not move | at least 98% | 1,412 of 1,412 (100%) | ok |
| Findings | 656 within 2% | 652 (-0.61%) | ok (unchanged target) |
| Median centre distance | at most 0.10 m | 0.0031 m | ok (unchanged target) |

All measured numbers from the run follow, unchanged.

# Measured run (before the ruling it read as a MISS on the original targets)

Run 2026-10-04 on the Step 2 project ("AF acceptance DAMAC 2", the replay state), task/af-x.

Method:
- I snapshotted every sighting's placement kind and centre from the project database.
- Then I ran `computePlacements` with `only_dirty: false` on the model.
- `asset_place` queued its own `asset_group` follow-up (`group_job_id` was present). That job succeeded, so
  grouping did run after the compute and no manual Regroup was needed.
- Then I compared each sighting with its replay state.
- No constant was changed.

## Timing
- `asset_place` over 1,441 sightings: 180 s.
- `asset_group`: under 5 s.
- A cached BVH is the follow-up if this is too slow; this run does not need one.

## Results

| Measure | Target | Replay | Recompute | Delta | |
| --- | --- | --- | --- | --- | --- |
| Patch | within 2% | 715 | 686 | -4.06% | MISS |
| Point | within 2% | 625 | 652 | +4.32% | MISS |
| None | within 2% | 101 | 103 | +1.98% | ok |
| Same placement kind | at least 98% | | 1,412 of 1,441 | 97.99% | MISS (one sighting short: 98% needs 1,413) |
| Findings | within 2% of 656 | 656 | 652 | -0.61% | ok |
| Median centre distance to replay | at most 0.10 m | | 0.0031 m (n 1,338; p90 0.0185 m; max 7.55 m) | | ok |

Transitions (replay to recompute):

| Transition | Count |
| --- | --- |
| point -> point | 625 |
| patch -> patch | 686 |
| none -> none | 101 |
| patch -> point | 27 |
| patch -> none | 2 |

Nothing went the other way.

Other numbers:
- Severity after the recompute: 470 findings at severity 1 and 182 at severity 2. Replay: 474 and 182.
- Grouping after the recompute: 0 new, 643 kept, 13 merged, 9 split, 652 groups.

## Reading

Every kind change goes one way: patch to point, plus 2 patches that become unplaced. Where both runs place a
sighting, the centres agree closely (median 3 mm).

So the miss is in the patch-or-point decision, not in the ray cast. For 27 sightings, the kit's placement made a
patch and Kestrel's `asset_place` (profile `building_facade`, mixed placement) chooses a point. I did not
tuned nothing.

Cause, checked read-only on the first replay project (4,495 photos):
- In the replay, 27 of the kit's patches belong to sightings whose box is a plain rectangle (no merged.json
  polygon); the other 679 patches are polygons.
- `place.wants_patch` applies the spec's mixed rule (§6.3): a polygon gives a patch, a box gives a pin.
- So on a recompute these 27 rectangles become points. That is exactly the 27 patch -> point transitions.
- The kit itself made patches for some rectangle findings (its surface.json holds them), so the two rules differ.

Options for the ruling:
1. Change the mixed rule so a rectangle can also get a patch, the way the kit does (this needs the kit's
   rule for when a rectangle gets one). It is a spec change to §6.3.
2. Accept the result and amend the recompute targets for kind counts and same-kind share.
