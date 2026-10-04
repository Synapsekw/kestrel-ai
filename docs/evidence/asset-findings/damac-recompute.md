# DAMAC recompute acceptance (X Step 3): MISS, stopped for a ruling

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
investigate further and did not tune anything.

Options for the ruling:
1. Look into why `asset_place` picks a point for these 27 (for example the patch coverage or grid rule
   against the kit's), and fix it if it is a defect.
2. Accept the result and amend the recompute targets for kind counts and same-kind share.
