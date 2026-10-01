---
type: adr
date: 2026-10-01
status: accepted
tags: [decision, gotcha]
related: ["[[2026-10-01-2131-s1-project-setup-wave]]"]
---

# Tauri's OS file drop blocks HTML5 drag inside the window

## Context

The new-project setup page (S1-U5) needs two kinds of drag. The operator drops folders from
Explorer onto the Data card, and moves sorted buckets between slots inside the page. Tauri 2's
`dragDropEnabled` (the window setting that delivers OS file drops as `onDragDropEvent`) is on by
default. On Windows, WebView2 then swallows HTML5 drag events inside the page, so `draggable` plus
`dragstart`/`drop` never fire. jsdom and Playwright's Chromium do not reproduce this, so unit and
e2e tests pass while the installed app does nothing.

## Decision

Keep `dragDropEnabled` on, because the OS folder drop is the feature. Move things inside the page
with pointer events, plus a **Move** menu as the keyboard and accessibility path. Never use HTML5
drag-and-drop for in-page reordering in this app.

## Rationale

Turning `dragDropEnabled` off would bring HTML5 drag back but lose real folder paths from Explorer.
A browser `File` from an HTML5 drop has no absolute path, and the sidecar needs paths. Pointer
events work in every WebView and in tests.

## Consequences

- Positive: folder drops and bucket moves both work in the installed app.
- Negative: any existing in-page HTML5 drag is probably broken in the installed build without any
  test failing.
- Open follow-ups: map-layer reordering in `frontend/src/mapws/chrome/LayerRowView.tsx` uses HTML5
  drag. Check it in the installed app, and port it to pointer events if it is dead (S1 index S-R14).

## Related

- `docs/superpowers/plans/2026-09-30-setup-index.md` (S-R14)
- `frontend/src/setup/folderDrop.ts`
