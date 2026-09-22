---
type: session
date: 2026-09-22-0627
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-21-gotcha-native-icon-verification]]"]
---

# Windows icon reference refreshed

## What changed

- No application source or binary changes. The operator reported an old Windows icon and asked to rebuild only if needed.
- Verified all 17 source icons; directly extracted the installed executable/setup, running-window SMALL/SMALL2 and shell shortcut icons. All already contained the approved bird. No stale matching taskbar/implicit shortcut was found, so the reported old bitmap was not reproduced by these reads.
- Copied the verified ICO to the installed folder under a content-specific filename and set the existing Start shortcut's explicit IconLocation. Preserved target and arguments; backed up the original shortcut under ignored `dist/windows-icon-2026-09-22/`.
- Sent synchronous Windows icon-reference notifications. Read the shortcut back and extracted the shell-resolved icon afterward; the bird is correct. No Explorer restart, cache deletion, credential changes or rebuild.
- App remains open (PID 14528, Kestrel AI); its executable hash matches the previously installed setup-agent build. Evidence: `docs/evidence/brand/2026-09-22-windows-icon-refresh/`.

## Why

The installed artwork was already correct. Refreshing the explicit Windows shortcut reference addressed the reported presentation without replacing an unchanged application binary.

## Open threads

- The specific stale display was not captured; verification covers native resources, the running window and shell-resolved shortcut. The refresh does not change installer behavior; a future installer can recreate the shortcut.
- Main's later editor/train CI fixes still await the next desktop distribution. Other existing backlog items remain unchanged.

## How to test

1. Find **Kestrel AI** in Start and check the amber bird icon.
2. Open the app and compare its Windows icon with the sidebar bird.

## Next session entry point

See the icon-refresh evidence README if a particular Windows surface still shows a different bitmap. Avoid a full rebuild until checking that surface against the already-correct executable and window icons.
