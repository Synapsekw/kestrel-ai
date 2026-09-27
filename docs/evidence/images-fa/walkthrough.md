# I-FA: how to test this

FA builds components; they become visible once I-FW assembles the Images workspace. Until then its
behaviour is covered by its vitest suites (`frontend/src/images/ai/*.test.*`, 20 test files, 136
cases) and by exercising the pieces directly (dev canvas lab / component tests) — there is nothing
an operator can click in the shipped app yet. Below is what I-FW will need to wire up, and how an
operator will check it once that merge lands. Steps that are not observable today are marked
**(not yet observable)**.

## Differences from the plan I-FW should know about

- **FW must mount `AiHosts` unconditionally**, once for the whole Images workspace — not behind
  the S tool, the hint bar or any other condition. `AiHosts` (`frontend/src/images/ai/AiHosts.tsx`)
  hosts the two pieces of always-on state: the S session (`SmartPolygonSession`) and the
  Shift+A / Shift+X bulk confirm (`BulkConfirm`). The plan described a separate S session hook
  mounted by FW; the session is a leaf component instead because it subscribes to pan/zoom (`view`,
  `viewport`) and would otherwise re-render FW's whole workspace host on every pan frame. With
  `AiHosts` mounted, `SmartPolygonPanel` and `HintBar` are purely presentational: FW may render them
  only where and when they are visible (`HintBar` no longer takes a `projectId`). `BatchDetectWatch`
  is likewise always mounted.
- **SAM has a fourth availability, `"absent"`**, for builds with no assist routes at all (distinct
  from `"missing"`/`"invalid"`/`"unavailable"`). The panel shows "Smart polygon is not available in
  this build" and does not offer Get model or Try again.
- **`retry()` lives on the handle**, not as a separate export. After SAM parks on `unavailable`
  (server load failure) or `error`, the panel's "Try again" button calls
  `useSamHandle().retry` — nothing new is exported from `frontend/src/images/ai/index.ts` for it.

## Operator steps (once I-FW merges)

1. Open a project with images, open an image, press **D** (or the AI button in the palette). The
   menu "Run a library model on this image" lists the library models that reach the project's
   types, each with its task · types and its mAP.
2. Press **D** again (or Enter). The AI bar "Model · detecting…" shows at the top. When it ends, a
   toast reads "<Model>: N new, M already covered", plus "· ran on CPU" if training holds the GPU.
3. Teal dashed outlines appear; the hint bar reads "N AI suggestions on this image". Press **]** a
   few times: weak suggestions disappear and the hint bar says how many are hidden. Reopen the
   project: the threshold is kept.
4. Press **A**: the top suggestion turns solid in its type colour, the inspector opens the new
   finding, and a toast says "✓ Accepted as finding F-0xxx". Press **3**: the finding's severity
   becomes Major.
5. Press **X** on the next one: it fades; toast "✕ Rejected · kept as a training negative".
6. Press **Tab** repeatedly: it walks the remaining suggestions, then the image's findings, then
   opens the next image that has suggestions. **Ctrl+Z** after an accept puts the suggestion back.
7. Press **S** on a machine without the SAM weights: the panel offers "Get smart polygon model
   (≈78 MB)" and **Get model**; the download shows in Jobs. If the build has no assist routes at
   all, the panel instead reads "Smart polygon is not available in this build" and the other tools
   work as usual. If SAM failed to load (server-side), the panel offers **Try again**.
8. With the weights present, press **S**: a thin bar runs along the canvas top while the view is
   prepared. Click a spall: a dashed teal outline follows, and Shift+click excludes. "CPU" shows
   while training runs. Press **Enter**: a polygon is created (its provenance says smart polygon).
   Esc clears the points; a second Esc deselects.
9. Click empty ground with S: "Nothing found here, try another point".
10. Open `…/images?batch=1`: "Detect on many images" queues a run; when it ends, the toast offers
    "Review suggestions →".

All ten steps are **(not yet observable)** until I-FW mounts `AiHosts` (unconditionally), `AiBar`,
`HintBar`, `SuggestionChip`, `SmartPolygonPanel`, `SamWarmEdge`, `SuggestionsLayer`, `AiDetectButton`, `ModelMenu`,
`BatchDetectDialog` and `BatchDetectWatch`, and calls `ensureAiRegistered()` and `useAiWorkspace()`
per the interfaces in `frontend/src/images/ai/index.ts`. This is not a user-observable change by
itself: FA is a library of components and hooks with no route or screen of its own.

## What is checked today

- `pnpm -C frontend exec vitest run src/images/ai src/images/tools src/images/workspace src/images/canvas`
  exercises every behaviour in steps 1-10 against FC's real store and a faked API/backend client
  (`frontend/src/images/ai/testing.tsx`), including the SAM state machine, the batch dialog, the
  review/accept/reject flow, and the keyboard rows.
- The full gate (below) confirms FA's code compiles clean, does not regress FC's or any other
  suite, and the app still builds and boots end-to-end (e2e), with FA's files touching nothing
  outside `frontend/src/images/ai/` and one one-line import fix in
  `frontend/src/screens/EditorScreen.tsx` (the `ConfidenceFloor` move).
