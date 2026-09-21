---
type: session
date: 2026-09-21-1706
branch: main
trigger: wrapup
status: complete
tags: [session]
related: []
---

# UI design directions

## What changed

- Nothing shipped this block. The operator requested visual choices before app-code changes. No backend, frontend, contract, dependencies, or app behavior changed.
- Inspected PRODUCT.md, DESIGN.md, current shell/routes/navigation/Home/components, and repository UI evidence captures dated September 19–20. Those captures predate the Kestrel rename; they were not represented as a fresh installed-app walkthrough.
- Created an isolated, local visual study outside the repository at `C:/Users/D/.codex/visualizations/2026/09/21/01a0c43b-ec9a-7c83-ae7c-56d9b4b3bbe4/kestrel-directions/`. `index.html`, `styles.css`, and `app.js` show Fieldwork, Contour, and Studio across Home, Images, and Review. The study uses three local Ahmadia photographs and illustrative counts, confidence values, and boxes. No model or API is called.
- `verify.cjs` and `verification.txt` in that directory record prototype browser checks: all nine screens render with loaded images; accept/undo, confidence filtering, box visibility, Jobs, image filters/search; horizontal fit at 1024, 768, and 390 pixels; reduced motion; notes-dialog dismissal; no JavaScript runtime errors. Nine screen captures were rendered and the primary concept screens inspected.
- The only repository edits in this block are this session note and the north-star update. App gates were not run because no app source was modified. The existing `2e35dd9` commit observed during the block belongs to earlier installed-build documentation, not this work.

## Why

The user wants a more considered visual and interaction experience, and explicitly wants to choose a direction before implementation. The main design opportunities are a larger image workspace, less competing chrome, more progressive filtering, and a visual resume point on Home.

## Open threads

- Await operator selection: A Fieldwork (bright surfaces, graphite navigation, orange actions); B Contour (dark review workspace, compact rail, amber actions); C Studio (cool light surfaces, horizontal navigation, emerald actions).
- Recommendation: Fieldwork as the overall foundation, with Contour's compact review composition as a possible combination. This is a proposal, not an approved implementation decision.
- The prototype's remaining navigation entries are disabled and marked as outside the visual concept. Progress is a static sample. Accept/reject edits are in-memory and reset on reload.
- No implementation spec, plan, worktree, or app-code commit was created. A chosen redesign must follow the repository's budget/DAG, worktree, contract, and test requirements.

## How to test

1. Open `http://127.0.0.1:8120/` while the local preview server is running. If needed, start `node serve.cjs` from the study directory above. The server listens only on loopback.
2. Choose Fieldwork, Contour, or Studio. Use Home, Images, and Review to compare the same screens in each direction.
3. On Images, change status filters and search filenames. Click a frame to open Review.
4. Select a suggestion in the image or inspector, adjust confidence, accept or reject, then undo. Verify matching box/list feedback. Open Jobs and close it with Escape.
5. Open Design notes for tradeoffs and the inspected baseline. Resize the window or enable reduced motion to compare behavior.

## Next session entry point

Ask for the selected direction or combination, referring to the interactive study. Confirm the concrete redesign scope after selection, then write the specification with budget and execution DAG before building in a task worktree. Preserve background jobs and bounded image reads.
