---
type: adr
date: 2026-09-30
status: accepted
tags: [decision, setup, import]
related: ["[[2026-09-30-project-setup-design]]", "[[2026-10-01-photo-import-is-per-folder]]"]
---

# Setup imports a folder of visual and thermal photos once

## Context

A DJI M30T or H20T writes its visual (`_V`) and thermal (`_T`) photos into the same folder. The
setup page sorts them into two slots (Visual photos, Thermal photos), but `POST /projects/{id}/sources`
imports a whole folder, and posting a known folder again re-imports it rather than adding a second
source.

## Decision

On Create, the dispatcher keys each import by its path (`importPlan.ts` `pathKey`: either slash, no
trailing separator, case-insensitive) and sends **one** `POST /sources` per folder. A unit carries
the route of the SLOT its bucket sits in (a GeoTIFF moved to the Elevation slot imports through
`/elevations`), and a path is dispatched once across all buckets and routes: the first bucket in
order wins, and a later bucket on the same route only adds its slot to the unit. The photo unit is
listed under both slots; a failure shows under both, and Retry on either re-imports the folder once.
The Data card says "Visual and thermal photos in the same folder are imported together".
Coordinator ruling S-R4; spec §7.4.

## Consequences

- Inside the project, visual and thermal photos of one folder are one source. Keeping them apart (a
  per-image thermal flag, or a file list on `POST /sources`) is deferred (spec §15).
- Skipping only the thermal bucket of a shared folder still imports the thermal photos, because the
  folder is imported whole.
- The importer is recursive (`prepare.list_images` is `folder.rglob("*")` over `IMAGE_EXTS`), while
  the inspect groups photos by their immediate folder. So a photo folder inside another dispatched
  photo folder is folded into the outer one (one `POST /sources`), and a photo folder with a map or
  elevation GeoTIFF in or under it is not started at all: `IMAGE_EXTS` includes `.tif/.tiff` and
  `ImportSettings` has no extension filter, so the GeoTIFF would become a "photo". The Overview says
  "Photos in <folder> were not imported: the folder also holds GeoTIFFs ... Move the GeoTIFFs out of
  it, then Retry." (plan ruling U6-6). An extension filter or file list on `POST /sources` would
  remove this limit.
- Pinned by `frontend/src/setup/importPlan.test.ts`, `e2e/setup-journey.spec.ts` and the real-backend
  `e2e/setup-real-backend.spec.ts` (one source with two images).
