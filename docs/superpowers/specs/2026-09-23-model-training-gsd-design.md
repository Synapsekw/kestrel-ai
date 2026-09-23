---
type: spec
date: 2026-09-23
status: approved
tags: [spec, maps, inference, scale, models]
related: ["[[2026-09-22-geotiff-maps-design]]", "[[2026-09-23-survey-timeline-design]]"]
---

# A model carries the scale it was trained at

## 1. Goal

A map run today asks the operator for a `target_gsd_cm` and defaults it to the map's own ground
sample distance. That default means "do not resample", and it is wrong for every model whose
training imagery was flown at a different height than the survey being analysed.

The observed failure, on project `AHTest`, map `UTM_transparent_mosaic_group1` (86 904 x 49 118 px
at 2.296 cm/px) with model `ICVD_V4`:

| what the run found | box (map px) | on the ground |
| --- | --- | --- |
| dump_truck, conf 0.36 | 60 x 75 | 1.4 x 1.7 m |
| dump_truck, conf 0.32 | 54 x 66 | 1.2 x 1.5 m |
| excavator, conf 0.26 | 76 x 65 | 1.7 x 1.5 m |

Three detections on a whole construction site, each about 1.5 m across. A dump truck is 8.9 m. The
model was not finding machines badly; it was finding 1.5 m of gravel, because every real machine on
that map was roughly eight times larger than anything it had ever been shown.

The same model on the project's other map (3.174 cm/px) produced `counts: {}` - nothing at all.

This spec makes a model carry the scale it was trained at, so a run resamples the map to match.

### Why this is not a rendering bug

It was first reported as "the labels are too small". They are: at the default `view.fit()` a 60 px
box is 0.8 screen px. But drawing those boxes larger would only draw a careful outline around the
wrong thing. The legibility work in section 7 is real and is kept, but it is the second half of the
problem, not the first.

## 2. The invariant

> One model-input pixel must cover the same ground distance at inference as it did at training.

Everything below follows from that sentence.

Training letterboxes an image's long side to `imgsz`, so the frame's whole ground width maps to
`imgsz` pixels. The ground width a frame covers is `alt x sensor_width / focal_length` (similar
triangles). Therefore:

```
train_gsd_cm = (alt_cm x sensor_width_mm) / (focal_mm x imgsz)
```

For `ICVD_V4` (senseFly Aeria X, focal 18.5 mm, sensor 23.456 mm, median altitude 191.02 m,
`imgsz` 1280):

```
(19102.175 x 23.4558) / (18.5 x 1280) = 18.92 cm/px
```

A run on the 2.296 cm/px map therefore wants `target_gsd_cm = 18.92`, which is `gsd_scale` 0.121 -
a **8.24x downsample**. Machines then land at about 45 px, which is where the training data put
them (median labelled box: 42 x 47 px at the model input).

Note what the formula does **not** need: no stored image width, and no real-world machine sizes.
The long side maps to `imgsz`, so ground width / `imgsz` *is* the model's ground sample distance.

## 3. Deriving it is nearly free

The expensive input is already in the database. `image.alt` is populated at import (482 values for
dataset `ICVD_V3`), so altitude costs no file I/O. Only the camera intrinsics need EXIF, and those
are a property of the camera, not the frame - a sample of at most 8 images settles them.

This keeps the read **bounded** in the sense AGENTS.md requires: a median over a column already in
SQLite, plus eight EXIF headers. It is sub-second, so it is a plain request, not a background job.

### 3.1 Sensor width

In order of preference, first that resolves wins:

1. `ExifImageWidth / FocalPlaneXResolution`, converted by `FocalPlaneResolutionUnit`
   (2 = inch, 3 = cm). The Aeria X reports 6000 px and 2558 px/cm, giving 23.456 mm.
2. `36 / (FocalLengthIn35mmFilm / FocalLength)` - the 35 mm crop factor. For the Aeria X this gives
   23.79 mm, within 1.4 % of (1), which is why it is an acceptable fallback.
3. Nothing resolves: no estimate. The model keeps a null `train_gsd_cm` and section 6 applies.

`ExifImageWidth` is the **original** capture width, which is what the focal-plane resolution is
measured against. It is deliberately not the stored width: import downscales to `max_side` 4000,
and the two must not be confused.

### 3.2 Altitude

The median of `image.alt` across the dataset's images. `ICVD_V3` ranges 184.6 - 199.1 m; the median
is 191.02 m.

This is GPS altitude, which is above mean sea level, not above ground. That is the single weakest
input in the derivation, and it is why section 4 exists.

### 3.3 The cross-check

Because GPS altitude can be wrong by the site's elevation, a derived GSD is never stored without
evidence a human can read. The check converts the dataset's own labelled boxes into metres at the
derived stored-image GSD (`ground_width / stored_width`; 6.055 cm/px for `ICVD_V3`):

| class | n | avg box (px) | implied size |
| --- | --- | --- | --- |
| roller | 33 | 83.7 | 5.07 m |
| bulldozer | 142 | 129.6 | 7.85 m |
| excavator | 181 | 138.6 | 8.39 m |
| backhoe | 49 | 140.6 | 8.51 m |
| dump_truck | 245 | 147.0 | 8.90 m |
| crane | 58 | 296.3 | 17.94 m |

Every one of those is a real machine size, which is what makes the 18.92 cm/px trustworthy. A bad
altitude shows up here immediately: a 2x altitude error would claim 17 m dump trucks.

The implementation asserts the **median** implied size into a 2 - 25 m band. Outside it, the
estimate is returned flagged as implausible and is not offered as a default.

The band is deliberately wide. It is a smoke alarm for an order-of-magnitude error, not a judgement
about what the operator is detecting - a project counting pallets or trees is not wrong, it just
does not get a silent default.

**What it therefore does not catch.** `ICVD_V3`'s median implied object is 8.5 m, so an altitude
wrong by a factor of two still lands on 17 m machines, comfortably inside the band. The band cannot
catch that, and widening its ambition would start rejecting real sites. This is precisely why
section 4 puts the number in front of the operator with its evidence rather than storing it
silently: the band catches the gross error, and a human catches the subtle one. The test suite
pins this limitation explicitly so nobody later mistakes the band for a proof.

## 4. Where the number comes from, per model

`Model.train_gsd_cm`, one nullable float.

- **New trained models**: the training job derives it on completion and stores it.
- **Existing trained models**: the column starts null. The first map run that selects such a model
  derives the estimate in the New Run dialog, shows it with the section 3.3 evidence, and asks the
  operator to accept or correct it. Accepting writes it to the model, so it is asked once.
- **Imported models with no dataset** (`yolo11m-coco`): nothing to measure. Section 6.

No backfill runs in the migration. Deriving needs image I/O, and AGENTS.md requires a failed
migration to log and continue - a migration that half-populates a column it cannot retry is worse
than a null.

## 5. The run-time default

`runModel.ts:23` currently ends `?? mapGsd`. That fallback is deleted. The map's own GSD stops
being a default anywhere in the product; it remains available as a manual entry, because an
operator analysing imagery at the model's native scale is a legitimate, and now explicit, choice.

New precedence for the New Run dialog's `target_gsd_cm`:

1. `model.train_gsd_cm`
2. a derived estimate, confirmed by the operator (section 4), which then becomes (1)
3. the last run of this model on any map
4. nothing - and the run cannot start (section 6)

**The order matters, and it is not the current one.** Today the last run wins outright
(`runModel.ts:21-23`). `ICVD_V4` already has a run recorded at `target_gsd_cm` 2.296 - the wrong
value that produced the gravel. Any ordering that lets a past run outrank a derived scale would
hand that number straight back, and the fix would never fire for the one model that prompted it.

So a past run is demoted to a last resort: it is what an operator explicitly chose *when nothing
could be derived*, which is precisely the case where it carries information. When a scale can be
derived, it is derived, and the operator confirms it once.

## 6. A run with an unknown scale cannot start

When no scale can be established, **Start is disabled** until the operator enters one, with the
field focused and one line explaining what the number means.

This is the rule that would have prevented the reported failure. The old behaviour silently
substituted a plausible-looking number and produced a confident, wrong answer; a disabled button
that asks a question is strictly better than a run that wastes an hour of GPU to find gravel.

## 7. Legibility (independent of everything above)

Even at a correct scale, an 8.9 m machine is 331 map px, which is 4.6 screen px at the default
full-extent view. The overlay needs to stay readable regardless.

`runLayer.ts`'s `boxStyle` becomes resolution-aware. The decision is extracted as a pure function so
it is testable without a map:

```
markFor(w, h, resolution) -> "clamped" | "box" | "labelled"
```

| on-screen size | mark |
| --- | --- |
| < 14 px | the box held at 14 px, centred on the detection: a screen-constant square drawn as `RegularShape({points: 4, angle: PI/4})` over a `Point` geometry override |
| 14 - 40 px | the true footprint, as today |
| > 40 px | the true footprint plus an `ol/style/Text` class name |

The layer gets `declutter: true`, so overlapping labels drop out instead of piling up.

When clamped, the footprint is no longer to scale. That is honest: at that resolution the true
footprint is smaller than the stroke drawing it, so nothing truthful was visible to lose.

The existing density-dot switch is untouched. It fires on the server's `truncated` flag (more than
5000 boxes) and remains the right answer for that case - a sea of 14 px squares is not.

## 8. Budget and execution DAG

**Budget.** GSD estimation is a bounded read: one median over a SQLite column plus at most 8 EXIF
headers. No image pixels are decoded and no image set enters memory. It is fast enough to be a
plain request rather than a job. Detection runs remain background jobs with progress, unchanged.

**DAG.**

| unit | depends on |
| --- | --- |
| **A** contract: `Model.train_gsd_cm`, the estimate endpoint, regenerated `schema.d.ts` | - |
| **B** backend: migration, `app/models/gsd.py`, estimate endpoint, PATCH, training job writes it | A |
| **C** frontend: New Run dialog default, confirm-estimate, disabled Start | A, B |
| **D** frontend: `markFor` and the overlay styles | - |
| **E** gates, evidence, operator walkthrough | B, C, D |

**D is independent of A, B and C** and runs in parallel with the whole chain.
Critical path: **A -> B -> C -> E**.

## 9. Testing

**Backend** (`backend/tests/test_model_gsd.py`)

- the arithmetic against the real senseFly numbers: 18.92 cm/px from focal 18.5, sensor 23.456,
  alt 191.02, imgsz 1280
- sensor width from `FocalPlaneXResolution` with both unit 2 and unit 3
- the 35 mm crop-factor fallback when focal-plane tags are absent
- no usable EXIF at all yields no estimate rather than a guess
- the cross-check accepts `ICVD_V3`'s real distribution and rejects an order-of-magnitude error in
  either direction, with an explicit test pinning what it does **not** catch (see below)
- the EXIF sample is capped at 8 images however large the dataset

**Frontend**

- `markFor` at each threshold and either side of both boundaries
- `NewRunDialog`: defaults to `train_gsd_cm`; offers a derived estimate when the model has none;
  Start stays disabled with no scale and enables once one is entered
- `runModel.test.ts` updated for the new precedence, with a regression test pinning the reported
  case directly: a model with a null `train_gsd_cm` and a past run at the map's native GSD must
  **not** default to that past run

**Contract.** `openapi.yaml` and the generated `contract/client/schema.d.ts` change in the same
commit, per the standing invariant.

Then the full gate in AGENTS.md section 4.

## 10. Out of scope

- **Retraining.** `ICVD_V4` scores `map50` 0.111 overall and 0.022 on excavator. Fixing the scale
  removes a systematic error; it does not make this a good model. That is a training-data
  conversation, and it is a separate one.
- **Per-class scale.** A crane is 18 m and a roller is 5 m; one GSD serves both, as it did in
  training. Nothing here suggests per-class resampling is worth its complexity.
- **Oriented boxes.** `angle` stays null on the map-detect path, as today.
- **Re-running past runs.** Existing runs keep their recorded `target_gsd_cm`. They are a record of
  what was actually computed, and rewriting that would be a lie.
