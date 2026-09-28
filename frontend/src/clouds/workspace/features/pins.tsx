import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import { PIN_CAP } from "@/api/cloudFindings";
import { messageOf } from "@/api/errors";
import { deleteFinding, patchFinding, type FindingPatch } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import type { CloudPick } from "@/clouds/CloudViewer";
import { parseFinding } from "@/clouds/jump";
import { reviewKeysLive } from "@/clouds/keys";
import { locationLabel } from "@/clouds/pins/callout";
import { FindingsTab } from "@/clouds/pins/FindingsTab";
import { PinCalloutCreate, PinCalloutView } from "@/clouds/pins/PinCallout";
import { PinsLayer } from "@/clouds/pins/PinsLayer";
import { NEUTRAL_PIN_COLOUR } from "@/clouds/pins/pinView";
import { DRAFT_ID, type CloudPin } from "@/clouds/pins/types";
import { useCloudPins } from "@/clouds/pins/useCloudPins";
import { useFindingArrival } from "@/clouds/pins/useFindingArrival";
import { readLastType, usePinTool } from "@/clouds/pins/usePinTool";
import type { Vec3 } from "@/clouds/viewer/types";
import { formatFindingNumber } from "@/findings/format";
import { useInspectorCommands } from "@/findings/inspectorStore";
import { useFindingKeys } from "@/findings/useFindingKeys";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { ownFindingsWrite } from "@/store/changesOwnWrite";
import { Button, Dialog, severityOf, toast, useSeverityScale } from "@/ui";
import { isTypingTarget } from "@/ui/keymap";
import type { FeatureContext, MinimapMark, WorkspaceFeature, WorkspaceTool } from "../types";

/**
 * An open dialog, list or menu owns its keys. A local copy of the (unexported) helper in
 * `workspace/useWorkspaceTool.ts` (ruling T10-7).
 */
const inOverlay = (t: EventTarget | null) =>
  t instanceof Element && t.closest('[role="dialog"],[role="menu"],[role="listbox"]') !== null;

interface PendingMove {
  p: Vec3;
  u: number | null;
  normal: Vec3 | null;
}

/**
 * Final-review ruling (Important 2): what an own create or Move pin wrote, shown at once while the
 * refetch runs. It applies only while the listed pins are still `seen` (the list when the write
 * answered); the next list replaces it.
 */
interface Pending {
  cloudId: string;
  seen: CloudPin[];
  created: CloudPin[];
  moved: ReadonlyMap<string, PendingMove>;
}

const sameP = (a: Vec3, b: Vec3) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** The listed pins with the pending writes laid over them; the 500 cap still holds. */
function withPending(listed: CloudPin[], pending: Pending | null): CloudPin[] {
  if (!pending) return listed;
  const moved = listed.map((p) => {
    const m = pending.moved.get(p.id);
    return m ? { ...p, p: m.p, u: m.u, normal: m.normal } : p;
  });
  const added = pending.created.filter((c) => !listed.some((p) => p.id === c.id));
  return added.length === 0 ? moved : [...added, ...moved].slice(0, PIN_CAP);
}

/**
 * C-P1 (spec §9, W1 plan Ruling 1): the pin tool (M), the pins layer (z 5), the callout (z 12), the
 * Findings tab with F's inspector, the finding dots on the minimap, the `?finding=` arrival and the
 * finding keys (Delete, 1–9, T, Shift+O/R/C, J/K; Esc deselects in Orbit).
 */
export function usePinsFeature(ctx: FeatureContext): WorkspaceFeature {
  const { projectId, cloud, viewer } = ctx;
  const api = useApi();
  const navigate = useNavigate();
  const scale = useSeverityScale();
  const { types, defectTypes } = useProjectTypes(projectId);
  const listedPins = useCloudPins(projectId, cloud.id);
  const listed = listedPins.pins;
  const latest = useRef(ctx);
  const listedRef = useRef(listed);
  useEffect(() => {
    latest.current = ctx;
    listedRef.current = listed;
  });

  // Own creates and moves, shown until the list catches up (final-review ruling, Important 2).
  const [pending, setPending] = useState<Pending | null>(null);
  const [dropped, setDropped] = useState<{ entry: Pending; listed: CloudPin[]; error: string | null } | null>(
    null,
  );
  const livePending = pending && pending.cloudId === cloud.id && pending.seen === listed ? pending : null;
  if (pending && !livePending) {
    // A newer list arrived (or the cloud changed): the optimistic entries go; the effect below
    // logs any the list did not confirm (a failed refetch, a pin outside the 500 drawn).
    setPending(null);
    if (pending.cloudId === cloud.id) setDropped({ entry: pending, listed, error: listedPins.error });
  }
  useEffect(() => {
    if (!dropped) return;
    const { entry, listed: now, error } = dropped;
    const err = error ? ` (${error})` : "";
    for (const c of entry.created)
      if (!now.some((p) => p.id === c.id))
        pushLog(`pins: ${formatFindingNumber(c.number)} not in the refetched list${err}`);
    for (const [id, m] of entry.moved) {
      const p = now.find((q) => q.id === id);
      if (!p || !sameP(p.p, m.p))
        pushLog(`pins: moved pin ${id} not at its new spot after the refetch${err}`);
    }
  }, [dropped]);
  const shown = useMemo(() => withPending(listed, livePending), [listed, livePending]);
  const pins = useMemo(
    () => (shown === listed ? listedPins : { ...listedPins, pins: shown }),
    [shown, listed, listedPins],
  );
  const addPending = useCallback(
    (f: (p: Pending) => Pending) => {
      const seen = listedRef.current;
      setPending((prev) =>
        f(
          prev && prev.cloudId === cloud.id && prev.seen === seen
            ? prev
            : { cloudId: cloud.id, seen, created: [], moved: new Map() },
        ),
      );
    },
    [cloud.id],
  );

  // Keyed by cloud, so a cloud switch clears the selection without an effect.
  const [sel, setSel] = useState<{ cloudId: string; id: string } | null>(null);
  const selectedId = sel && sel.cloudId === cloud.id ? sel.id : null;
  const selectedPin: CloudPin | null = pins.pins.find((p) => p.id === selectedId) ?? null;
  const select = useCallback(
    (id: string | null) => {
      setSel(id ? { cloudId: cloud.id, id } : null);
      if (id) latest.current.showTab("findings");
    },
    [cloud.id],
  );

  const { reload } = listedPins;
  const onCreated = useCallback(
    (pin: CloudPin) => {
      addPending((p) => ({ ...p, created: [...p.created, pin] }));
      select(pin.id);
      reload();
    },
    [addPending, select, reload],
  );
  const onMoved = useCallback(
    (id: string, p: Vec3, u: number | null, normal: Vec3 | null) => {
      addPending((prev) => ({ ...prev, moved: new Map(prev.moved).set(id, { p, u, normal }) }));
      reload();
    },
    [addPending, reload],
  );
  const tool = usePinTool({ projectId, cloudId: cloud.id, viewer, onCreated, onMoved, seams: ctx.seams });
  const submitRef = useRef<(() => void) | null>(null);
  const [calloutEl, setCalloutEl] = useState<HTMLDivElement | null>(null);
  const [confirming, setConfirming] = useState<CloudPin | null>(null);
  const [deleting, setDeleting] = useState(false);

  useFindingArrival({
    projectId,
    routeCloudId: cloud.id,
    search: ctx.search,
    viewer,
    pins,
    onArrive: select,
  });

  // Delete, and Esc-to-deselect in Orbit (plan Ruling 9); W1 routes Enter/Esc to the armed tool.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target) || inOverlay(e.target)) return;
      const idle = !tool.draft && !tool.moving;
      if (e.key === "Delete" && selectedPin && idle) {
        e.preventDefault();
        e.stopPropagation();
        setConfirming(selectedPin);
        return;
      }
      if (e.key === "Escape" && selectedId && idle && latest.current.activeTool === "orbit") {
        e.preventDefault();
        e.stopPropagation();
        select(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [tool.draft, tool.moving, selectedPin, selectedId, select]);

  const patchSelected = useCallback(
    async (patch: FindingPatch) => {
      if (!selectedPin) return;
      const id = selectedPin.id;
      try {
        // G5/T10-1: a known-id write registers its echo and bumps `findingsRevision` itself.
        await ownFindingsWrite([id], () => patchFinding(api, projectId, id, patch), { bumpOnError: true });
      } catch (e) {
        toast("danger", messageOf(e, "could not update the finding"));
      }
    },
    [api, projectId, selectedPin],
  );
  const live = () => reviewKeysLive(viewer.current?.navMode() ?? "orbit");
  useFindingKeys(selectedPin !== null && !tool.draft && !tool.moving, scale.length, {
    onSeverity: (level) => {
      if (live()) void patchSelected({ severity: level });
    },
    onStatus: (status) => {
      if (live()) void patchSelected({ status });
    },
    onTypePicker: () => {
      if (live()) useInspectorCommands.getState().openTypePicker();
    },
    onMove: (delta) => {
      const list = pins.pins;
      if (!live() || list.length === 0) return;
      const i = selectedId ? list.findIndex((p) => p.id === selectedId) : -1;
      const next = i === -1 ? 0 : i + delta;
      if (next >= 0 && next < list.length) select(list[next].id);
    },
    onClose: () => false, // Esc is handled above (Orbit only) and by W1's tool routing
  });

  // Ruling 15: Move pin sets the pending move and arms the pin tool; the next pick PATCHes and arms Orbit.
  const { startMove } = tool;
  const onMovePin = useCallback(
    (id: string) => {
      startMove(id);
      latest.current.arm("pin");
    },
    [startMove],
  );

  const movingPin = tool.moving ? (pins.pins.find((p) => p.id === tool.moving) ?? null) : null;
  const pinTool: WorkspaceTool = {
    id: "pin",
    picks: true,
    onPick: (p: CloudPick) => {
      const wasMoving = tool.moving !== null;
      tool.pick(p);
      if (wasMoving) latest.current.arm("orbit");
    },
    onDisarm: () => {
      tool.cancel();
    },
    onCommit: () => submitRef.current?.(),
    canCommit: tool.draft !== null,
    commitLabel: "Create",
    // A5: a draft's callout carries its own Create/Cancel; don't repeat them in the hint bar.
    hintActions: tool.draft === null,
    // T7-3: true after dropping a draft (stay armed), false after cancelling a pending Move pin (W1 arms Orbit).
    onCancel: () => tool.cancel(),
    hint: movingPin ? (
      <span className="text-xs text-muted">{`Click the new spot for ${formatFindingNumber(movingPin.number)}`}</span>
    ) : undefined,
  };

  const confirmDelete = async () => {
    if (!confirming) return;
    setDeleting(true);
    const { id } = confirming;
    try {
      // G5/T10-2: as `patchSelected`; the pin goes on the refetch the bump triggers.
      await ownFindingsWrite([id], () => deleteFinding(api, projectId, id), { bumpOnError: true });
      toast("ok", `${formatFindingNumber(confirming.number)} deleted`);
      if (selectedId === confirming.id) select(null);
      setConfirming(null);
    } catch (e) {
      toast("danger", messageOf(e, "could not delete the finding"));
    } finally {
      setDeleting(false);
    }
  };

  const onNavigate = useCallback(
    (href: string | null) => {
      if (href === null) return select(null);
      const [path, query = ""] = href.split("?");
      const id = parseFinding(new URLSearchParams(query));
      if (id && path.endsWith(`/clouds/${cloud.id}`)) select(id);
      else void navigate(href);
    },
    [cloud.id, navigate, select],
  );

  const draft = tool.draft;
  const callout = draft ? (
    <PinCalloutCreate
      key={draft.p.join(",")}
      defectTypes={defectTypes}
      initialTypeId={readLastType()}
      busy={tool.busy}
      locationText={locationLabel(draft.p[2], draft.normal)}
      onCreate={(v) => void tool.create(v)}
      onCancel={() => tool.cancel()}
      submitRef={submitRef}
    />
  ) : selectedPin ? (
    <PinCalloutView
      projectId={projectId}
      pin={selectedPin}
      types={types}
      onClose={() => select(null)}
      onDelete={() => setConfirming(selectedPin)}
    />
  ) : null;

  const minimap = useMemo<MinimapMark[]>(
    () =>
      pins.pins.map((p) => ({
        kind: "dot",
        x: p.p[0],
        y: p.p[1],
        colour: severityOf(scale, p.severity)?.colour ?? NEUTRAL_PIN_COLOUR,
        label: formatFindingNumber(p.number),
      })),
    [pins.pins, scale],
  );
  const number = confirming ? formatFindingNumber(confirming.number) : "";

  return {
    name: "pins",
    tools: [pinTool],
    findingsTab: {
      count: pins.total,
      body: (
        <FindingsTab
          projectId={projectId}
          cloud={cloud}
          pins={pins}
          types={types}
          selectedId={selectedId}
          onSelect={select}
          viewer={viewer}
          moving={tool.moving}
          onMovePin={onMovePin}
          onNavigate={onNavigate}
          maps={ctx.maps}
        />
      ),
    },
    layer: (
      <PinsLayer
        viewer={viewer}
        pins={pins.pins}
        types={types}
        draft={draft}
        selectedId={draft ? DRAFT_ID : selectedId}
        clipBox={ctx.clipBox}
        calloutEl={calloutEl}
        onSelect={(id) => {
          if (id !== DRAFT_ID) select(id);
        }}
      />
    ),
    floating: (
      <>
        <div
          ref={setCalloutEl}
          className="kp-callout"
          data-testid="cloud-callout"
          data-state="hidden"
          data-side="right"
        >
          {callout && (
            <>
              <span className="kp-callout-arrow" aria-hidden />
              {callout}
            </>
          )}
        </div>
        <Dialog
          open={confirming !== null}
          title={`Delete ${number}?`}
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                Keep
              </Button>
              <Button variant="danger" loading={deleting} onClick={() => void confirmDelete()}>
                {`Delete ${number}`}
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">Its photos and comments go with it.</p>
        </Dialog>
      </>
    ),
    minimap,
  };
}
