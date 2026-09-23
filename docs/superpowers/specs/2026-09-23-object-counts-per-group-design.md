# Object counts per group (flight) — design

**Date:** 2026-09-23
**Status:** approved by the operator in brainstorming; no plan written yet
**Related:** `docs/superpowers/specs/2026-09-17-kestrel-ai-app-design.md` (§1 "a trained detector and a
report", §5 import/grouping), `PRODUCT.md`, `vault/00-north-star.md` §4

## 1. Problem

The pitch promises a team "reviewed counts per flight". Today the app gives box totals: the CSV and
the HTML report sum every box in a group. On this imagery that number is several times too large.
Frames are about 28 m apart, taken every 3 seconds at roughly 193 m altitude with a 65° horizontal
field of view, so the same object appears in several consecutive frames. Summing sightings counts it
once per frame.

A person reading the app wants **how many distinct objects were on the site during that flight**,
per class, with a way to check the number.

### Not machinery-specific

The app detects whatever a project defines: construction machinery today, plants or trees or
power-line anomalies next. Nothing in this feature names a domain. It counts **objects** of the
project's own classes, and every tolerance is derived from the data rather than from vehicle sizes.
(The app still has machinery wording elsewhere — the editor's "No machinery (N)", the default class
list, agent placeholders. Making those neutral is a separate task, agreed with the operator.)

## 2. What this is not (v1)

- No Excel export and no trend across survey dates. Both were considered and deferred.
- No manual merge or split of objects. A wrong count is fixed by fixing the boxes, in the editor and
  review screens that already exist, and recounting.
- No tower or facade geometry. Projection assumes each class sits at a known height above a flat
  ground plane (default 0). An object on a structure needs its class height set; an inclined site is
  approximated by one elevation per group.
- No image-feature registration. It was considered as an alternative to metadata-based projection
  (see §9) and rejected for v1.

## 3. Data

### 3.1 Camera pose per image (migration)

Nullable columns on `image`: `yaw`, `pitch`, `roll` (degrees) and `hfov` (horizontal field of view,
degrees). They are read at import from the source file's XMP:

- senseFly / Pix4D: `Camera:Yaw`, `Camera:Pitch`, `Camera:Roll` (the reference dataset: eBee X with
  an Aeria X camera, GPS accuracy 0.014 m, IMU yaw accuracy 10°).
- DJI: `drone-dji:GimbalYawDegree`, `GimbalPitchDegree`, `GimbalRollDegree`.

`hfov` comes from EXIF `FocalLengthIn35mmFilm` (35 mm frame width 36 mm), else from `FocalLength`
plus the sensor width when the make/model is known. Missing values stay null.

**The import currently drops XMP.** It converts frames to JPEG and preserves EXIF only, so attitude
exists solely in the operator's source files. Import therefore reads the XMP from the *source* bytes
before conversion. For projects imported earlier, a **pose backfill job** re-reads each source file's
header. It never decodes pixels, and files that have moved are skipped and counted in the result.

The migration is additive and nullable. A project that never gets pose data keeps working; it gets
the §6 fallback.

### 3.2 Count snapshots

- `count_run`: id, project, `group_key`, settings (confidence threshold, merge factor, maximum frame
  gap, ground elevation, per-class heights), `method` (`projected` | `peak_in_frame`), `reason` when
  it fell back, `input_fingerprint`, created_at.
- `counted_object`: id, run, class id, east/north metres from the group origin, lat/lon, best
  confidence, sighting count, and the box ids that formed it.

A snapshot is a record of a computation, never the source of truth for boxes.

**Staleness.** `input_fingerprint` covers the group's contributing boxes (ids, review states,
confidences) and the settings. The screen compares it on load and shows **Out of date** when it
differs. A stale run is never recomputed silently: counting is a job the person starts.

## 4. Counting

A `count` job, one group at a time, with progress:

1. **Pose check.** If fewer than 90% of the group's frames have `yaw` and `hfov`, fall back (§6).
2. **Ground elevation.** The 5th percentile of the group's frame altitudes, or the operator's
   override. (The first frames of a flight are the take-off run, so the low tail approximates the
   ground.)
3. **Select boxes.** Accepted and edited boxes always; unreviewed boxes at or above the confidence
   threshold (default 0.25); rejected boxes never.
4. **Project.** For each box centre, build the camera ray from its pixel offset and the field of
   view, rotate it by yaw/pitch/roll, and intersect it with the plane at that class's height above
   ground. Result: east/north metres from the group origin (its first frame), and lat/lon.
5. **Cluster per class.** Sightings in frame order; union two when they are within the class
   tolerance and at most `max_frame_gap` frames apart (default 8). Union-find, linear in sightings.
   **Tolerance** = the median projected diagonal of that class's boxes in this group × `merge_factor`
   (default 1.0), with a 2 m floor, and grown by 10% of the sighting's distance from its frame
   centre to absorb attitude error. Derived per class, so trees a few metres apart stay separate
   while sightings of one excavator merge.
6. **Write** the run and its objects in one transaction.

**Known limits, stated in the UI:** an object that moves far between frames (a truck at 10 m/s moves
about 30 m in 3 s) can be counted more than once; two identical objects closer together than the
tolerance can merge into one. Both are visible when inspecting an object's sightings.

## 5. Screens

A new pipeline step **Counts** between Review and Export, at `/p/:projectId/counts`.

- **Groups table:** group, capture date and time range, frame count, one column per class, a state
  pill (Up to date / Out of date / Not counted yet), and **Count** / **Recount**. A project total line
  above it. Settings fold behind "More options" on the count action, so the common path is one click.
- **Selected group:** a map drawn from the data with no internet basemap — the flight path through
  the frame positions, one marker per object in its class colour, metres with a scale bar — beside
  the class list with counts and visibility toggles.
- **Inspecting an object:** class, best confidence, how many frames saw it, and a thumbnail strip of
  those sightings; each opens that frame in the editor at that box. Fixing a box marks the group out
  of date; **Recount** refreshes the number.
- **Wording:** "objects", never "machines". A group is labelled "group (flight)".

## 6. Fallback and errors

- **No pose:** count the largest number of that class visible in any single frame of the group, shown
  as "at least N", with the reason ("no camera attitude in these frames"). It is a lower bound that
  never double-counts.
- **No GPS at all:** the same fallback, and no map.
- **Backfill against moved sources:** skipped files are counted and named in the job result.
- **Cancellation:** `count` and `pose_backfill` cancel like any job; a cancelled run writes nothing.
- **No capture time:** counting proceeds, the time column is blank.

## 7. API (contract first)

`contract/openapi.yaml` is the source of truth; `contract/client/schema.d.ts` is regenerated and
committed in the same change. `JobType` gains `count` and `pose_backfill`.

| Endpoint | Purpose |
| --- | --- |
| `POST /projects/{id}/counts` | start a count for one group with settings → `JobRef` |
| `GET /projects/{id}/counts` | latest run per group: counts per class, state, method, reason |
| `GET /projects/{id}/counts/{runId}/objects` | the objects, cursor-paginated |
| `GET /projects/{id}/counts/{runId}/objects/{objectId}/sightings` | frames and boxes behind one object |
| `POST /projects/{id}/pose-backfill` | read attitude from a source's original files → `JobRef` |

## 8. Budget and bounded reads

- **Background jobs with progress:** `count` and `pose_backfill`. Nothing blocks the UI.
- **Bounded reads:** the count job streams a group's boxes and frame rows in pages and holds only
  sightings (a few floats each) in memory; no image pixels are decoded. Backfill reads file headers,
  never whole images. The screen loads objects by cursor and frame positions per group — hundreds of
  rows — and thumbnails only for the object being inspected.
- **Cost target:** a 622-frame group counts in under 30 s on the reference machine.

## 9. Alternatives considered

- **Image registration** (feature matching between consecutive frames to chain boxes): needs no
  metadata and so would work with any drone, but it is CPU-heavy at 4000 px, unreliable over
  featureless ground, and much more code. Revisit only if projection proves inaccurate.
- **Peak in one frame as the only answer:** exact and trivial, but a lower bound, not the number a
  person asked for. Kept as the fallback.
- **Detections labelled honestly ("38 sightings across 622 frames")**: truthful and free, but it is
  not a count of objects. The report's existing totals already serve that need.

## 10. Success criteria

1. A 622-frame group counts in under 30 s, as a job with progress, and can be cancelled.
2. Every counted object can be traced to the frames that saw it, and a wrong box is fixed with the
   existing editor/review tools; recounting updates the number.
3. On flight `0033` of the reference dataset, with the operator's trained model, the projected count
   is within 15% of a hand count of that flight, and the difference is explainable.
4. A group without pose data still produces a labelled lower bound, and the app never claims a
   precision it does not have.
5. No screen, string or default in this feature assumes the objects are machinery.

## 11. Execution DAG

**Units**

- **U1 pose at import** — XMP readers (senseFly/Pix4D, DJI), `hfov` derivation, migration, import wiring.
- **U2 pose backfill job** — job type, source-file walk, skip accounting. Depends on U1's migration.
- **U3 projection + clustering** — pure functions, no I/O: ray/plane intersection, class tolerance, union-find.
- **U4 count job and storage** — `count_run` / `counted_object`, selection, fingerprint, job wiring. Depends on U3, U1.
- **U5 contract** — endpoints, `JobType` values, regenerated client. Independent of U1–U4; needed before U6/U7.
- **U6 counts API handlers** — depends on U4, U5.
- **U7 Counts screen** — table, state pills, settings, job progress. Depends on U5 (mock-driven).
- **U8 map and object inspection** — depends on U7, U6.
- **U9 real-data check** — flight `0033` count versus a hand count. Depends on U6, U2.

**Parallel batches**

- Batch 1: U1, U3, U5 (no shared files).
- Batch 2: U2 (after U1), U4 (after U1, U3), U7 (after U5).
- Batch 3: U6 (after U4, U5), U8 (after U7).
- Batch 4: U9.

**Critical path:** U1 → U4 → U6 → U8 → U9.

## 12. Risks

- **Attitude error.** 10° yaw uncertainty displaces a sighting near the frame edge by tens of metres.
  Mitigated by growing the tolerance with distance from the frame centre, and measured in U9.
- **Migration order.** The parallel `task/project-agent` branch adds migration `0004_agent` and edits
  `openapi.yaml`. Whichever merges second rebases: the new revision chains onto the head on `main`,
  and the contract is regenerated after the merge, never hand-edited.
- **Ground elevation on a sloped site.** One elevation per group biases positions on a slope. Visible
  in U9; a future version can take a terrain height source.
