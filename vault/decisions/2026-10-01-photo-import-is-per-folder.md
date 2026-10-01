---
type: adr
date: 2026-10-01
status: accepted
tags: [decision, setup, import]
related: ["[[2026-09-30-project-setup-design]]", "[[2026-09-30-setup-imports-a-shared-thermal-folder-once]]"]
---

# Photo import is per folder, so setup cannot import a hand-picked subset of photos

## Context

`POST /projects/{id}/sources` imports a whole folder, recursively (`prepare.list_images` is
`rglob` over `IMAGE_EXTS`). For an images bucket `InspectBucket.files` is empty, so the draft holds a
folder and a count, never a list of photos. When the operator drops or browses individual photo
FILES onto the setup page, the inspect still reports the folder, and Create would import every photo
in it, not just the ones chosen (U3 final review F1).

## Decision

When an images bucket came from a dropped or browsed file, the page says so before Create.
`draftStore.applyInspect` sets `DraftBucket.wholeFolder` when the bucket's folder is neither a run
path nor under one. The slot and the Summary then say "The whole folder <name> will be imported"
(`wholeFolderText` in `model.ts`). Photos dispatch once per top-most folder (see
[[2026-09-30-setup-imports-a-shared-thermal-folder-once]]), and a photo folder that holds GeoTIFFs
is held back with a fix-and-Retry message.

## Consequences

- A per-source file list or extension filter on `POST /sources` is the proper fix (spec §15
  follow-up). It would also lift the GeoTIFF hold-back.
- The case "the count is below the folder's photos" is not detectable without the frontend listing
  a folder, which it never does. The notice is shown for every file-sourced images bucket, whether
  or not the folder holds more photos than were dropped.
- Pinned by `draftStore.test.ts` (`wholeFolder` set and not set) and `model.test.ts` (the Summary's
  `wholeFolders`).
