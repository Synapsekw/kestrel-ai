### Task 6: Frontend drawer

**Files:**
- Create: `frontend/src/api/projectAgent.ts`, `frontend/src/agent/AgentDrawer.tsx`, `frontend/src/agent/project/{ProjectAgent.tsx,useProjectAgent.ts,Transcript.tsx,ToolRow.tsx,ApprovalCard.tsx}`, tests `frontend/src/agent/project/ProjectAgent.test.tsx`, `frontend/src/api/projectAgent.test.ts`
- Modify: `frontend/src/app/Shell.tsx` (render `<AgentDrawer projectId={projectId} open onClose />` instead of `<SetupAgent>`), `frontend/src/app/Header.tsx` (button label/aria: "Project agent" inside a project, "Setup agent" outside — read the current button code), `frontend/src/App.tsx` EventsBridge: also forward events to `useProjectAgentEvents` (a tiny zustand store `agent/project/agentEvents.ts` with `bump(projectId)` counter the hook subscribes to).

**Interfaces:**
- Consumes: generated types `AgentConversation`, `AgentItem`, `AgentTurn`, `AgentApproval`, `AgentNavigate`, `ProviderName` from `@contract/client`; `useApi()`; `unwrap` from `api/errors`; `useProviders` (see `api/useProviders.test.tsx` / `api/providers.ts` for how the Setup agent learns which providers have keys); `useJobsStore` for live job progress.
- Produces:

```ts
// api/projectAgent.ts
export function fetchConversation(api, projectId): Promise<AgentConversation>
export function startTurn(api, projectId, body: { provider: ProviderName; message: string }): Promise<AgentTurn>
export function cancelTurn(api, projectId, turnId): Promise<AgentTurn>
export function decideApproval(api, projectId, turnId, approve: boolean): Promise<AgentTurn>
export function clearConversation(api, projectId): Promise<void>
// agent/project/useProjectAgent.ts
export function useProjectAgent(projectId: string, open: boolean): {
  items: AgentItem[]; turn: AgentTurn | null; busy: boolean /* turn running */; awaiting: boolean;
  provider: ProviderName; setProvider(p): void; providersReady: boolean; hasKey(p): boolean;
  message: string; setMessage(s): void; send(): Promise<void>; stop(): Promise<void>;
  decide(approve: boolean): Promise<void>; clear(): Promise<void>; error: string | null;
}
```

Behaviour: fetch on open and on every `agent.changed` for this project (debounced 150 ms); while `turn.state === "running"` also poll every 3 s as a fallback. Provider choice persists in `localStorage` key `kestrel.agent.provider` (try/catch). `open_screen` items navigate (`useNavigate`) only for items whose `seq` is greater than the highest seq seen at first load (so reopening does not replay navigation); screens map to routes in `routes.tsx` (images→`data`, label→`label`, review→`review`, datasets, models, train, detect→`query`, export, settings, home→`/p/:id`, editor→`edit/:imageId`).

UI (see spec "UI"; mirror `SetupAgent.tsx` layout, width, focus handling, Escape to close, `aria-label="Project agent"`): transcript `role="log"` `aria-live="polite"`; user bubble `bg-well`; assistant text `whitespace-pre-wrap`; hide empty assistant text; `ToolRow` shows a status icon/Pill (`running` live accent, `ok` success, `error` danger, `denied` muted, `awaiting_approval` warning), the tool summary or a humanised tool name while running, a Disclosure with the input JSON; for each job id, a `Progress` bar from `useJobsStore` when the job is known. `ApprovalCard` (role="group", aria-label="Approval needed"): title, detail, `≈ $X.XX` when estimated_cost is non-null, buttons "Approve" (primary) and "Deny" (secondary). Composer: `Textarea` (maxLength 4000; Enter sends, Shift+Enter newline), "Send" disabled while busy/awaiting or no key; "Stop" button while busy; header "Clear" IconButton disabled while busy/awaiting. Empty state with three example prompts as buttons that fill the composer: "Label the first 500 images with excavator and dump truck", "How many images still have unreviewed suggestions?", "Build a dataset from the labeled images and train yolo11n for 30 epochs". Footer note: "Messages, tool results and any image the agent views go to your selected provider." Missing key: Alert with a link to `/settings`. Turn failed: Alert with `turn.error`.

- [ ] **Step 1: Failing tests** (vitest + Testing Library; see `agent/SetupAgent.test.tsx` for how the API is mocked with a fake client): drawer shows Setup agent outside a project and Project agent inside; renders user/assistant/tool items; approval Approve/Deny call `decideApproval`; Send calls `startTurn` and clears the composer; Stop calls `cancelTurn`; Clear disabled while running; missing key state; `open_screen` navigates only for new items; api module sends the right paths/bodies.
- [ ] **Step 2: Run** `pnpm -C frontend exec vitest run src/agent src/api/projectAgent.test.ts` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `pnpm -C frontend lint` and `pnpm -C frontend exec tsc -b` clean.
- [ ] **Step 5: Commit** `feat(ui): project agent drawer`.

