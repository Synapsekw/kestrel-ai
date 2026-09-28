# Photo link: operator eye checks (spec §16 criteria 7 and 8)

Dev mode, Edge 154.0.4258.37, RTX 5070 Ti (ruling G1). Run 2026-09-28 by C-G Task 11 (criterion 8's
automated round trip) and Task 11b (criterion 7, re-run on the stack wall) on the chimney
cloud (`chimney.las`, 21 697 184 points, EPSG:32639) with the chimney's own DJI flight (DJI FC6540,
420 photos, read in place from the NAS; 395 are near the cloud, all 395 posed: `cameras.json`).

These checks need a person (ruling G9). The driver made the clicks and saved the lists and screenshots;
**no row below is marked passed by the automation**. Mark each `pending operator` cell `yes` or `no`.

I-FW has merged (ruling G10), so each `photolink-<k>-image.jpg` is the images workspace after the
cloud → image jump. It shows I-FW's arrival ring and the "Back to 3D" chip.

## Criterion 7: 10 wall picks (Task 11b)

The flight stays below the rim: the rim is at z ≈ 189.3 in the cloud, and `cameras.json` gives a
camera z median of 98.0 and p99 of 160.7. Task 11's spots (a 1.5 m circle at the rim) put every
first-photo spot on the photo's top edge, so Task 11b moved the spots to the stack's wall **15-30 m
below the rim** (z 159.3-174.3), where the photos look.

How the spots were derived (a throwaway script over the source LAS, not committed):

- The stack's section in that band is centred at **243517.737, 3178246.543** (a circle fit to the
  band's points within 8 m of S1's rim centre; radius 1.92 m). In this cloud the section drifts
  north-east with depth, and the upper stack overhangs the band's south-west side, so a straight-down
  pick there lands on the upper stack.
- The driver reaches a spot with `?at=`, whose Z refine keeps the **topmost** point within 2 m
  (`useJumpArrival.ts`, `Z_REFINE_M = 2`, `pickDown`). So for each of 10 azimuths round the side the
  band can be reached from (300°, 320°, 340°, 0°, 20°, 40°, 60°, 120°, 140°, 160°, counter-clockwise
  from grid east), the spot is the XY nearest the axis (0.25 m steps) whose topmost point within 2 m
  is in the band, with at least 30 points within 1 m below it (solid wall, not a stray point).

Then the Photo link tool (I) picks at the canvas centre, and the first listed photo is opened. Files:
`photolink/photolink-<k>.jpg` (the 3D view with the list and the pick's readout),
`photolink/photolink-<k>-image.jpg` (the first photo, opened at the spot), and
`photolink/photolink-full.json` (every row's list and URL). "Listed" is the panel's heading; the list
itself shows up to 50 rows, which is what the JSON's `hits` holds.

| k   | Spot (E, N)             | Spot's top z (below rim) | Pick (E, N, Z, from the readout)  | Listed | First photo (image id, spot px, ring px)      | Ring contains the picked feature? | Any far-side photo in the list? |
| --- | ----------------------- | ------------------------ | --------------------------------- | ------ | --------------------------------------------- | --------------------------------- | ------------------------------- |
| 1   | 243519.862, 3178242.862 | 171.77 (17.5 m)          | 243519.87, 3178244.70, 169.63     | 54     | `124dc2a6…` (DJI_0047), 2092.0, 498.8, r 407  | pending operator                  | pending operator                |
| 2   | 243520.993, 3178243.811 | 172.03 (17.3 m)          | 243521.00, 3178248.60, 166.70     | 62     | `124dc2a6…`, 2030.7, 749.2, r 391             | pending operator                  | pending operator                |
| 3   | 243521.496, 3178245.175 | 172.03 (17.3 m)          | 243521.55, 3178254.84, 161.62     | 76     | `124dc2a6…`, 1870.7, 1111.3, r 371            | pending operator                  | pending operator                |
| 4   | 243521.237, 3178246.543 | 172.51 (16.8 m)          | 243521.36, 3178256.44, 161.10     | 76     | `124dc2a6…`, 1813.4, 1141.0, r 367            | pending operator                  | pending operator                |
| 5   | 243520.556, 3178247.569 | 173.04 (16.3 m)          | 243520.51, 3178248.40, 169.99     | 54     | `124dc2a6…`, 2003.9, 489.2, r 392             | pending operator                  | pending operator                |
| 6   | 243519.078, 3178247.668 | 173.75 (15.5 m)          | 243518.91, 3178238.08, **182.24** | 19     | `9864abfc…`, 1613.6, **0.0**, r 396           | pending operator                  | pending operator                |
| 7   | 243518.487, 3178247.842 | 173.38 (15.9 m)          | 243518.46, 3178249.55, 171.38     | 52     | `124dc2a6…`, 1820.9, 379.4, r 391             | pending operator                  | pending operator                |
| 8   | 243515.237, 3178250.873 | 171.15 (18.1 m)          | 243515.50, 3178241.56, **180.80** | 21     | `9864abfc…`, 1366.3, **0.0**, r 383           | pending operator                  | pending operator                |
| 9   | 243512.375, 3178251.043 | 171.17 (18.1 m)          | 243512.83, 3178426.35, **−4.35**  | 113    | `de72e52a…` (DJI_0001), 1301.9, 1028.9, r 223 | pending operator                  | pending operator                |
| 10  | 243512.334, 3178248.510 | 159.57 (29.7 m)          | 243512.42, 3178250.61, 157.16     | 86     | `124dc2a6…`, 1366.4, 1495.2, r 394            | pending operator                  | pending operator                |

What the automation already shows (facts, not a verdict on the eye check):

- Every pick lists at least one photo (19-113).
- 7 picks landed on the wall in or near the band, at z 157.2-171.4 (17.9-32.1 m below the rim).
  Picks 6 and 8 landed on the upper stack (182.2 and 180.8 m, 7-9 m below the rim): the canvas-centre
  click, from the arrival's oblique view, hit the stack above the spot. Pick 9 hit the ground 184 m
  north of the stack (the click passed the thin wall).
- 8 of 10 first-photo spots are inside the frame (py 379-1495). Only picks 6 and 8, the upper-stack
  hits, are clamped to the top edge (py = 0.0), as every pick was in Task 11.
- Before (Task 11, rim spots): picks 4 and 6 listed no photo, and all 8 first-photo spots had
  py = 0.0.

### How to do the eye check (operator)

1. Open `docs/evidence/clouds/photolink/photolink-<k>-image.jpg` for each row. The dashed ring is
   the spot. Does it contain the wall feature the pick hit? The pick's view is `photolink-<k>.jpg`,
   and its readout (bottom centre) gives the picked E/N/Z, as in the table.
2. For the far-side column, open the photos in the row's list. They are listed in
   `photolink-full.json` → `rows[k-1].hits`, as "Open photo n, method, distance". Is any of them
   taken from the far side of the stack, so that the picked surface faces away from the camera?
3. To do the same live, run from the worktree root. It takes about 2 minutes, and the Edge window
   closes by itself:

   ```powershell
   $env:KESTREL_SPOTS = "[[243519.862,3178242.862],[243520.993,3178243.811],[243521.496,3178245.175],[243521.237,3178246.543],[243520.556,3178247.569],[243519.078,3178247.668],[243518.487,3178247.842],[243515.237,3178250.873],[243512.375,3178251.043],[243512.334,3178248.510]]"
   .\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode photolink
   ```

   Or run `-Mode hold`, which keeps the workspace open until you close the tab. Press I, click the
   wall, and click each listed photo.

4. Write `yes`/`no` into the two right-hand columns above.

## Criterion 8: image → cloud (5 photo pixels)

### Operator run (the criterion itself): pending operator

1. `.\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode hold`.
   In the Edge window, pick 5 features on the stack with the Point tool (P, click, Enter). Write down
   their E/N/Z from the readout, then close the tab.
2. For each feature, open a photo that shows it (the images workspace), and note the image id and
   the feature's pixel (u, v) in stored-image pixels.
3. Write `D:\kestrel-acceptance\clouds\image-px.json` as
   `[{"image_id": "…", "u": …, "v": …, "expected": [E, N, Z]}, …]` (5 entries). Then:

   ```powershell
   $env:KESTREL_IMAGE_PX = Get-Content D:\kestrel-acceptance\clouds\image-px.json -Raw
   .\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode image2cloud
   Copy-Item D:\kestrel-acceptance\clouds\out\image2cloud-* docs\evidence\clouds\photolink\
   ```

   A row passes when `d ≤ 1.0` m.

| #   | Image id | Pixel (u, v) | Hand-picked 3D point | Arrival pick | d (m) | Pass             |
| --- | -------- | ------------ | -------------------- | ------------ | ----- | ---------------- |
| 1   |          |              |                      |              |       | pending operator |
| 2   |          |              |                      |              |       | pending operator |
| 3   |          |              |                      |              |       | pending operator |
| 4   |          |              |                      |              |       | pending operator |
| 5   |          |              |                      |              |       | pending operator |

### Automated self-consistency (NOT the operator's eye check)

This check runs no eye and no hand pick. Five real points of the source LAS are taken on the
stack's outer wall. Each is the outermost point of a 20° azimuth window centred on a multiple of 72°,
14–33 m below the rim (z ≈ 189.3). Each point is projected into its best posed photo with the app's
own pinhole model: `photoLink.ts` `photosSeeing`, which uses `cameraBasis` and
`kx = W/2 / tan(hfov/2)`, with the facing test on the wall's outward horizontal normal and a 10 %
frame margin. The model was re-implemented in a throwaway script (not committed) that read the
`GET …/cameras` payload. The resulting `{image_id, u, v, expected}` pairs
(`photolink/image-px-automated.json`) went through the driver's `image2cloud` mode, which runs the
app's own image → cloud arrival (`lookThrough`, `toCanvas`, pick). It is a round trip: cloud →
pixel with one half of the camera model, then pixel → cloud with the other.

Only the 0° and 72° sectors had any photo facing the wall (the flight covers the stack's north and
north-east sides).

| #   | Image id    | Pixel (u, v) | Expected (E, N, Z)               | Arrival pick (E, N, Z)           | d (m)  | ≤ 1 m |
| --- | ----------- | ------------ | -------------------------------- | -------------------------------- | ------ | ----- |
| 1   | `e040f821…` | 2504, 407    | 243514.333, 3178247.742, 173.713 | 243516.467, 3178265.938, 173.862 | 18.321 | no    |
| 2   | `12ac12d2…` | 1245, 538    | 243519.269, 3178245.080, 172.527 | 243519.205, 3178245.160, 172.712 | 0.211  | yes   |
| 3   | `a9d0946a…` | 3067, 386    | 243514.737, 3178249.068, 167.663 | 243514.824, 3178249.051, 167.681 | 0.090  | yes   |
| 4   | `12ac12d2…` | 1310, 746    | 243521.191, 3178243.763, 169.083 | 243521.107, 3178243.918, 169.262 | 0.251  | yes   |
| 5   | `95a2a966…` | 2744, 1171   | 243512.817, 3178250.090, 157.765 | 243512.852, 3178248.171, 159.566 | 2.632  | no    |

**Result: 3 of 5 round trips land within 1 m (0.09–0.25 m). This is automated self-consistency,
not the operator's eye check, and does not decide criterion 8.**

The two misses may come from how the points were chosen rather than from the arrival:

- Row 1's expected point is a sparse point 5.6 m from the axis. The ray through its pixel reaches a
  surface 18 m further north.
- Row 5's point sits at the script's 8 m search radius, so it may not be the first surface along the
  ray.

Screenshots: `photolink/image2cloud-<k>.jpg`.
