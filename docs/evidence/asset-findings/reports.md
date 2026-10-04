# Reports acceptance (X Step 5): PASS

Rendered 2026-10-04 on task/af-x in the scratch acceptance projects, with brand **e&**.
- The e& logos (on light, on dark, flat) were found read-only in the Reference Pack under
  `asset-inspection-kit\brands\eand\`. They were imported as copies into the scratch app data through
  `PUT /brands/builtin-eand/logos/{slot}`, never into the repo.
- Report config:
  - cover on;
  - asset summary on (the acceptance model);
  - findings table (the register) on;
  - finding pages on, with "Pages for" set to severity 2 and above;
  - every other section off;
  - CSV layout `asset_sightings`;
  - formats PDF and CSV.
- Checks:
  - pages, and the text of each page, with `pypdfium2`;
  - em (U+2014) and en (U+2013) dashes searched in the extracted text;
  - `/SMask` counted by a raw byte scan of the file.

| Check | DAMAC | EBSM |
| --- | --- | --- |
| Project state | replay (656 findings, 182 at severity 2) | replay (78 findings, 77 at severity 2) |
| Brand on the version | builtin-eand, no warnings | builtin-eand, no warnings |
| Pages | 248 | 165 |
| Finding pages (pages headed "Finding F-...") | 182, one per severity 2 finding, no finding with two | 77, one per severity 2 finding |
| Register pages (findings table) | 63 | 9 |
| Photo continuation pages | none | 77 ("Photos") |
| Em or en dashes in text | 0 | 0 |
| `/SMask` (raw bytes) | 0 | 0 |
| File size | 100.0 MB | 29.8 MB |
| Render time | 10 s (the meshes were already cached by an earlier render) | 120 s cold, 10 s warm |

The DAMAC PDF holds one page for each severity 2 finding plus the register, as required. The remaining pages
are the cover and the asset summary.

## EBSM wording fix (operator ruling)

- Before the ruling, the EBSM finding pages read "seen in N photos", where N counted the mask regions on a single photo.
- After 08af9a24 (photo-unit findings count regions on one photo), the re-rendered EBSM PDF reads, for example,
  "Finding F-NNNN · Flare head · S · N regions on 1 photo", and "1 region on 1 photo" in the singular.
- Region-unit findings (DAMAC) keep "seen in N photos".
- The re-render passes the same checks: 165 pages, 77 finding pages, 0 dashes, `/SMask` 0.

## Other observations

- Street map (basemap WebGL textures, CORS):
  - Checked in a browser: Vite dev on 127.0.0.1:5972 against the backend on 5970, cross origin, through the same
    CORSMiddleware path the packaged app uses for tauri.localhost.
  - On the DAMAC model, 20 street tiles loaded with status 200 and there were no CORS or WebGL errors in the console.
  - The streets render under the model.
  - The packaged app itself was not checked, because the installer is built but not installed by rule.
- Overview speed on DAMAC (4,538 photos, 652 findings): `GET /overview` answers in 15 ms.
- Deferred minor: after a recompute regroup, the Overview's recent-findings strip can list closed,
  merged-away findings that have no sightings. Their thumbnail answers 404, so the tile shows no image.
- Report preview: the 3D locator shows a placeholder until a render (or a placement job) has loaded the
  mesh; the PDF always has it.
