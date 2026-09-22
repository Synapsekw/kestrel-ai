# Task 6 report: Project agent drawer (frontend)

Status: DONE_WITH_CONCERNS (minor, see Concerns)
Commit: `61a0e61 feat(ui): project agent drawer` on `task/project-agent`

## What was built

- `frontend/src/api/projectAgent.ts`: `fetchConversation`, `startTurn`, `cancelTurn`, `decideApproval`,
  `clearConversation`, each a thin `unwrap` over the generated client paths under
  `/api/v1/projects/{projectId}/agent`.
- `frontend/src/agent/project/agentEvents.ts`: zustand store `useProjectAgentEvents` with a per-project
  `revision` counter, `bump(projectId)`, and `applyEvent(ev)` (bumps on `agent.changed`).
- `frontend/src/agent/project/useProjectAgent.ts`: the hook with the interface from the brief, plus
  `pending`, `loaded`, `providers` and `providersError`. It:
  - fetches on open and on every `agent.changed` for this project (150 ms debounce), and polls every 3 s
    while `turn.state === "running"`. Out-of-order responses are dropped (request counter).
  - persists the provider in `localStorage["kestrel.agent.provider"]` (try/catch). With no stored
    choice it uses the first provider that has a key. Providers reload when the drawer is reopened.
  - navigates for `open_screen` items only when `seq` > the highest seq from the first read after
    opening. The baseline resets on each open, so reopening never replays navigation. Only the latest
    new target is used. The screen→route map is `screenRoute()` (images→data, detect→query,
    editor→edit/:imageId, home→/p/:id, and so on).
  - reads each job id it doesn't know yet once with `fetchJob` and upserts it into `useJobsStore`, so a
    job the agent started gets live progress. Events only update jobs the store already knows.
  - send / stop / decide / clear are serialised through one lock. The composer clears only after
    `startTurn` succeeds.
- `ToolRow.tsx`: an icon for the kind of tool, the summary (or the tool name made readable while it
  runs), and a status Pill: running = accent+live "Running", ok "Done", error "Failed", denied
  neutral "Declined", awaiting_approval warn "Needs approval". A "Details" Disclosure shows the input
  JSON. There is one `Progress` per known job id.
- `ApprovalCard.tsx`: `role="group"` `aria-label="Approval needed"`, title, detail,
  `≈ $X.XX` when `estimated_cost` isn't null, Approve (primary) and Deny (secondary).
- `Transcript.tsx`: `role="log"` `aria-live="polite"`, user bubble `bg-well`, assistant text
  `whitespace-pre-wrap`, empty assistant text hidden, and the approval card under the tool call that
  is awaiting approval.
- `ProjectAgent.tsx`: a 34rem non-modal drawer that mirrors SetupAgent (`id="project-agent"`,
  `role="dialog"`, `aria-label="Project agent"`, focus in on open, focus back to the opener on close,
  Escape closes). It has:
  - a header with the project name, a Clear conversation IconButton (disabled while running or
    awaiting approval, or when the conversation is empty) and a close button;
  - a provider Select with a model and readiness status line;
  - an empty state with the three example prompts as buttons that fill the composer;
  - a "Working…" status line, a failed-turn Alert showing `turn.error`, and an action-error Alert;
  - a missing-key Alert that links to `/settings` ("App settings");
  - a composer: Textarea with maxLength 4000, Enter sends, Shift+Enter or IME composition adds a
    newline; Send is disabled while busy, awaiting, pending, with an empty message or with no key;
    Stop shows while a turn runs;
  - the footer note, verbatim.
- `AgentDrawer.tsx`: shows the Setup agent outside a project and the Project agent inside one.
  **Deviation (needed to keep the Setup agent unchanged):** `useSetupAgent.create()` navigates to
  `/p/{newId}` with the drawer still open, and the Setup flow (import, first labeling) continues there.
  Choosing the mode from the route alone would swap in the Project agent mid-flow and break
  `e2e/setup-agent.spec.ts`. So the mode is fixed when the drawer opens: a drawer opened outside a
  project stays the Setup agent until it closes. SetupAgent stays mounted, so its session state
  survives. ProjectAgent is keyed by projectId.
- Edits:
  - `Shell.tsx` renders `<AgentDrawer projectId projectName open onClose>`.
  - `Header.tsx`: the button reads "Project agent" inside a project and "Setup agent" outside;
    `aria-controls` follows.
  - `App.tsx` EventsBridge forwards every event to `useProjectAgentEvents.getState().applyEvent`.

## Tests and TDD evidence

- RED: `pnpm exec vitest run src/api/projectAgent.test.ts` failed with "Failed to resolve import
  ./projectAgent". `pnpm exec vitest run src/agent/project` failed with "Failed to resolve import
  ./agentEvents". Later, the added latch test failed with "Unable to find ... dialog 'Setup agent'"
  before AgentDrawer fixed the mode at open.
- GREEN: `src/api/projectAgent.test.ts` passes 6 tests: paths, bodies, 204 and the 409 envelope.
  `src/agent/project/ProjectAgent.test.tsx` passes 17 tests:
  - Setup agent outside a project; Project agent inside, with focus;
  - the Setup agent stays through its move into the new project and becomes the Project agent after
    close and reopen;
  - Escape closes;
  - user, assistant and tool rendering, with empty assistant text hidden and Details JSON;
  - job progress from the store;
  - Approve and Deny call `decideApproval` with the right body, and the cost is shown or hidden;
  - Enter sends and Shift+Enter doesn't, the composer clears, and the right body is sent;
  - an example prompt fills the composer, then Send works;
  - Stop calls cancel, and Clear and Send are disabled while running;
  - Clear sends a DELETE when idle;
  - with a missing key, the App settings link shows and Send is disabled;
  - a failed turn shows its error;
  - the provider persists across remounts;
  - `open_screen` from history doesn't navigate, and a live one navigates to `/p/:id/edit/img-9`;
  - an event for another project is ignored, and two bumps give one debounced refetch.
- Full frontend: `pnpm lint` (eslint, prettier, tokens) is clean; `pnpm test` passes 126 files and
  560 tests; `pnpm exec tsc -b` is clean.

## Self-review notes

- One `eslint-disable-next-line react-hooks/set-state-in-effect` sits on `void load()` in the open
  effect, with a reason. `load` sets state only after the await, and SetupAgent's hook uses the same
  pattern.
- Keys, prompts and payloads are never logged. `pushLog` gets only the generic failure message.
- Reads are bounded: one conversation GET (the server caps it at 200 items) and one job GET for each
  job id not seen before.

## Concerns

1. The AgentDrawer mode is fixed at open, which goes beyond the brief (see above). While the Setup
   agent stays open inside its new project, the header button already reads "Project agent" and its
   `aria-controls="project-agent"` points at a panel that isn't rendered until the drawer is
   reopened. This is cosmetic. Changing it would mean moving the mode into `panelStore`, which isn't
   one of my files.
2. Task 7 e2e should know that the drawer button inside a project is now named "Project agent".
   `e2e/setup-agent.spec.ts` only clicks it on `/`, so it should be unaffected, but I didn't run the
   e2e suite (Task 7).
3. Clear conversation has no confirmation step (the brief doesn't ask for one).
