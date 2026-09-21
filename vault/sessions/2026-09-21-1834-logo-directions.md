---
type: session
date: 2026-09-21-1834
branch: main
trigger: wrapup
status: complete
tags: [session]
related: ["[[2026-09-21-1826-contour-desktop-rebuild]]"]
---

# Logo directions

## What changed

- Nothing shipped to the application this block. Starting HEAD `8d1b310`; working tree was clean.
- Read PRODUCT.md, DESIGN.md, Brand.tsx and native icon/installer configuration. Current branding
  is inconsistent: the in-app mark is a hard hat; the Windows icon is an orange rectangular outline.
- Generated preview-only concepts: A Kestrel (spread-wing bird), B Focus K (monogram/detection frame),
  C Survey Wing (three sweeping contour bands). All use Contour charcoal/amber. A is recommended
  for its direct relationship to the name and aerial vision.
- Refined the initial glowing presentations into a clearer white-background comparison sheet.
  These are raster concepts, not production vectors or validated small-size icon assets.
- Final preview is local to the conversation's generated images:
  `C:\Users\D\.codex\generated_images\01a0c43b-ec9a-7c83-ae7c-56d9b4b3bbe4\exec-c7856739-9466-4671-ab96-59b2506ccb0d.png`.
  No production files or installed assets changed. Only this vault handoff is committed.

## Why

The operator wants a meaningful logo and explicitly wants to choose among options before
implementation. The chosen identity must be consistent inside the software and in its installer.

## Open threads

- Await the operator's choice or refinement request; no concept is approved yet.
- After approval, create a clean vector master and deliberate small-size variants. Update
  `frontend/src/app/Brand.tsx`, native PNG/ICO/ICNS assets, Windows executable/taskbar/shortcut icons,
  and Inno Setup's setup/uninstall icon path. Check all visible brand surfaces and rebuild/install.
- Existing settings-layout, folder-rename and other backlog items remain unchanged.

## How to test

This block is not user-observable in the installed software; it only presents logo concepts for selection.

## Next session entry point

- The final three-column comparison in this conversation. Confirm the selected concept from the
  operator's next message, then implement the consistent asset family within the normal worktree flow.
