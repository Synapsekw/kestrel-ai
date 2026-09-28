# Photo link: operator eye checks (spec §16 criteria 7 and 8)

Dev mode, Edge 154.0.4258.37, RTX 5070 Ti (ruling G1). Run 2026-09-28 by C-G Task 11 on the chimney
cloud (`chimney.las`, 21 697 184 points, EPSG:32639) with the chimney's own DJI flight (DJI FC6540,
420 photos, read in place from the NAS; 395 are near the cloud, all 395 posed: `cameras.json`).

These checks need a person (ruling G9). The driver made the clicks and saved the lists and screenshots;
**no row below is marked passed by the automation**. Mark each `pending operator` cell `yes` or `no`.

I-FW has merged (ruling G10), so each `photolink-<k>-image.jpg` is the images workspace after the
cloud → image jump. It shows I-FW's arrival ring and the "Back to 3D" chip.

## Criterion 7: 10 rim picks

The spots are the brief's: 10 points on a 1.5 m circle round S1's rim centre (243513.718,
3178242.151), each reached with `?at=`. The Photo link tool (I) then picks at the canvas centre. The
first listed photo is opened. Files: `photolink/photolink-<k>.jpg` (the 3D view with the list),
`photolink/photolink-<k>-image.jpg` (the first photo, opened at the spot), and
`photolink/photolink-full.json` (every row's list and URL).

| k   | Spot (E, N)             | Photos listed | First photo (image id, spot px, ring px)  | Ring contains the picked feature? | Any far-side photo in the list? |
| --- | ----------------------- | ------------- | ----------------------------------------- | --------------------------------- | ------------------------------- |
| 1   | 243515.218, 3178242.151 | 11            | `12ac12d2…` (DJI_0276), 905.9, 0.0, r 328 | pending operator                  | pending operator                |
| 2   | 243514.932, 3178243.033 | 11            | `12ac12d2…`, 914.5, 0.0, r 328            | pending operator                  | pending operator                |
| 3   | 243514.182, 3178243.578 | 7             | `e040f821…`, 2501.6, 0.0, r 285           | pending operator                  | pending operator                |
| 4   | 243513.254, 3178243.578 | **0**         | none ("No photo saw this point")          | n/a: nothing listed               | n/a                             |
| 5   | 243512.504, 3178243.033 | 6             | `e040f821…`, 2577.3, 0.0, r 285           | pending operator                  | pending operator                |
| 6   | 243512.218, 3178242.151 | **0**         | none ("No photo saw this point")          | n/a: nothing listed               | n/a                             |
| 7   | 243512.504, 3178241.269 | 6             | `e040f821…`, 2568.0, 0.0, r 284           | pending operator                  | pending operator                |
| 8   | 243513.254, 3178240.724 | 6             | `e040f821…`, 2549.1, 0.0, r 283           | pending operator                  | pending operator                |
| 9   | 243514.182, 3178240.724 | 7             | `e040f821…`, 2501.6, 0.0, r 285           | pending operator                  | pending operator                |
| 10  | 243514.932, 3178241.269 | 7             | `e040f821…`, 2479.6, 0.0, r 284           | pending operator                  | pending operator                |

What the automation already shows (facts, not a verdict on the eye check):

- Picks 4 and 6 list no photo. The criterion asks for at least one photo per pick, so those two
  rows cannot pass whatever the eye check finds.
- In every listed row, the first photo's spot has `py = 0.0`, so the spot was clamped to the photo's
  top edge. The app's pinhole model puts the rim **above** the frame of these photos, which are
  inside the frame only through the ±3 m / 2° tolerance. The flight stays below the rim: the rim is
  at z ≈ 189.3 in the cloud, and `cameras.json` gives a camera z median of 98.0 and p99 of 160.7.
  The gimbal is pitched down (for example −14.6° on DJI_0276). `photolink-1-image.jpg` shows haze
  and the horizon under the ring, not the rim. A fair eye check would use spots on the stack's wall
  15–30 m below the rim, where the photos do look (see criterion 8 below). The brief's spots were
  used as written.

### How to do the eye check (operator)

1. Open `docs/evidence/clouds/photolink/photolink-<k>-image.jpg` for each row with a photo. The
   dashed ring is the spot. Does it contain the rim feature the pick hit? The pick's view is
   `photolink-<k>.jpg`, and its readout gives the picked E/N/Z.
2. For the far-side column, open every photo in the row's list. They are listed in
   `photolink-full.json` → `rows[k-1].hits`, as "Open photo n, method, distance". Is any of them
   taken from the far side of the stack, so that the picked surface faces away from the camera?
3. To do the same live, run from the worktree root. It takes about 2 minutes, and the Edge window
   closes by itself:

   ```powershell
   $spots = 0..9 | ForEach-Object { $a = $_ * 36 * [math]::PI / 180; "[{0:F3},{1:F3}]" -f (243513.718 + 1.5 * [math]::Cos($a)), (3178242.151 + 1.5 * [math]::Sin($a)) }
   $env:KESTREL_SPOTS = "[" + ($spots -join ",") + "]"
   .\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Mode photolink
   ```

   Or run `-Mode hold`, which keeps the workspace open until you close the tab. Press I, click the
   rim, and click each listed photo.

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
