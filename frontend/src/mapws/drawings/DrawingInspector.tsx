import { useEffect, useState } from "react";
import { useApi } from "@/api/client";
import { clearDrawingGeoref, type Drawing } from "@/api/drawings";
import { messageOf } from "@/api/errors";
import { useTools } from "@/mapws/context";
import type { InspectorBodyProps } from "@/mapws/inspect/inspectorRegistry";
import {
  Alert,
  Button,
  Dialog,
  IconButton,
  InspectorSection,
  Pill,
  Segmented,
  Switch,
  cx,
  toast,
} from "@/ui";
import { useAlignStore } from "../georef/alignStore";
import type { FitWarning, GeorefModelName, Vec2 } from "../georef/fit";
import { fitSummary, formatMetres, georefErrorText, savedFitSummary, WARNING_TEXT } from "../georef/messages";
import { ALIGN_TOOL_ID } from "./AlignOverlay";
import { reimportDrawing, toggleKnockout } from "./drawingActions";
import { familyOf, type DrawingFamily } from "./drawingImport";
import { DrawingLayerToggles } from "./DrawingLayerToggles";
import { useDrawing, useDrawingsStore } from "./drawingsStore";
import { saveAlignment } from "./saveAlignment";

const MODEL_OPTIONS: { value: GeorefModelName; label: string }[] = [
  { value: "similarity", label: "Similarity" },
  { value: "affine", label: "Affine" },
];
const TONE = {
  ok: "text-ok",
  info: "text-muted",
  warn: "text-warn",
  danger: "text-danger",
} as const;

function srcText(family: DrawingFamily, p: Vec2): string {
  return family === "vector"
    ? `${p[0].toFixed(2)}, ${p[1].toFixed(2)}`
    : `col ${Math.round(p[0])}, row ${Math.round(-p[1])}`;
}

function methodText(d: Drawing): string {
  const g = d.georef;
  if (!g) return "Not placed yet. Align it with control points (K).";
  if (g.method === "crs") return `Placed by its coordinates${g.epsg ? ` · EPSG:${g.epsg}` : ""}`;
  if (g.method === "embedded")
    return `Placed by its world file or GeoTIFF${g.epsg ? ` · EPSG:${g.epsg}` : ""}`;
  return `Placed with ${g.points.length} control points · ${g.model === "affine" ? "Affine" : "Similarity"}`;
}

/** Spec §5.3 "Drawing": georef method, control points, model, RMSE and warnings, Save placement. */
export function DrawingInspector({ selection, projectId }: InspectorBodyProps) {
  const id = selection.id;
  const api = useApi();
  const activate = useTools((s) => s.activate);
  const drawing = useDrawing(projectId, id);
  const session = useAlignStore((s) => (s.session?.drawingId === id ? s.session : null));
  const notice = useAlignStore((s) => (s.session?.drawingId === id ? s.notice : null));
  const [confirmClear, setConfirmClear] = useState(false);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // R-W5-9: deselecting the drawing (this Body unmounting) discards its unsaved session.
  useEffect(() => () => useAlignStore.getState().endFor(id), [id]);

  if (!drawing) return <p className="p-4 text-sm text-muted">Loading drawing…</p>;
  const d = drawing;
  const family = familyOf(d.format);
  const g = d.georef;
  const saved = g?.method === "control_points" ? g : null;
  const model: GeorefModelName = session?.model ?? (g?.model as GeorefModelName | null) ?? "similarity";
  const rows = session
    ? session.pairs.map((p, i) => ({
        ...p,
        residual: session.fit?.ok ? session.fit.residuals_m[i] : null,
      }))
    : (saved?.points ?? []).map((p, i) => ({
        id: p.id,
        src: p.src as Vec2,
        dst: p.dst as Vec2,
        residual: saved?.residuals_m[i] ?? null,
      }));
  const summary = session
    ? fitSummary(session.model, session.pairs.length, session.fit)
    : saved && saved.rmse_m !== null
      ? savedFitSummary(model, saved.points.length, saved.rmse_m)
      : null;
  const warnings: string[] = session
    ? (session.fit?.ok ? session.fit.warnings : []).map((w) => WARNING_TEXT[w as FitWarning])
    : (g?.warnings ?? []).map((w) => w.message);

  // Task 9 ruling: ending the session hands back to Select, so K is never left active and dead.
  function finish() {
    useAlignStore.getState().endFor(id);
    activate("select");
  }

  async function save() {
    if (!session?.fit?.ok) return;
    setBusy("save");
    setError(null);
    try {
      const next = await saveAlignment(api, projectId, session);
      finish();
      toast("ok", `Placement saved · RMSE ${formatMetres(next.georef?.rmse_m ?? 0)}`);
    } catch (e) {
      setError(georefErrorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    try {
      useDrawingsStore.getState().upsert(await clearDrawingGeoref(api, projectId, id));
      setConfirmClear(false);
    } catch (e) {
      setError(messageOf(e, "could not clear the placement"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <span className="text-2xs font-medium text-muted">Drawing</span>
        <h2 className="text-lg font-semibold text-ink">{d.name}</h2>
        <div className="flex flex-wrap items-center gap-1.5">
          <Pill size="sm">{d.format.toUpperCase()}</Pill>
          {g ? (
            <Pill tone="ok" size="sm">
              Placed
            </Pill>
          ) : (
            <Pill tone="warn" size="sm">
              Not placed
            </Pill>
          )}
        </div>
      </header>
      {d.status === "failed" && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" icon="refresh" onClick={() => reimportDrawing(d)}>
              Re-import
            </Button>
          }
        >
          {d.error}
        </Alert>
      )}

      <InspectorSection
        title="Placement"
        action={
          !session && d.status === "ready" ? (
            <Button size="sm" icon="align" onClick={() => activate(ALIGN_TOOL_ID)}>
              Align · K
            </Button>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted">{methodText(d)}</p>
          {session && (
            <Segmented
              label="Model"
              size="sm"
              options={MODEL_OPTIONS}
              value={model}
              onChange={(m) => useAlignStore.getState().setModel(m)}
            />
          )}
          {rows.length > 0 && (
            <table aria-label="Control points" className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-left text-2xs text-muted">
                  <th className="py-1 font-medium">#</th>
                  <th className="py-1 font-medium">Drawing</th>
                  <th className="py-1 font-medium">Map E / N</th>
                  <th className="py-1 font-medium">Residual</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-t border-line">
                    <td className="py-1 font-mono text-ok">{i + 1}</td>
                    <td className="py-1 font-mono">{srcText(family, r.src)}</td>
                    <td className="py-1 font-mono">
                      {r.dst[0].toFixed(2)} / {r.dst[1].toFixed(2)}
                    </td>
                    <td className="py-1 font-mono">{r.residual === null ? "–" : formatMetres(r.residual)}</td>
                    <td className="py-1 text-right">
                      {session && (
                        <IconButton
                          icon="trash"
                          size="sm"
                          label={`Delete point ${i + 1}`}
                          onClick={() => useAlignStore.getState().removePair(r.id)}
                        />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {session?.pendingSrc && (
            <p className="text-sm text-accent-ink">Now click the same point on the map.</p>
          )}
          {notice && <Alert tone="info">{notice}</Alert>}
          {summary && (
            <p data-testid="georef-rmse" className={cx("font-mono text-sm tabular-nums", TONE[summary.tone])}>
              {summary.text}
            </p>
          )}
          {warnings.map((w) => (
            <Alert key={w} tone="warn">
              {w}
            </Alert>
          ))}
          {error && <Alert tone="danger">{error}</Alert>}
          {session ? (
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => void save()}
                loading={busy === "save"}
                disabled={!session.fit?.ok}
              >
                Save placement
              </Button>
              <Button size="sm" onClick={finish}>
                Discard
              </Button>
            </div>
          ) : (
            g && (
              <div>
                <Button size="sm" variant="danger" onClick={() => setConfirmClear(true)}>
                  Clear placement
                </Button>
              </div>
            )
          )}
        </div>
      </InspectorSection>

      {family === "vector" && d.status === "ready" && (
        <InspectorSection title="Layers">
          <DrawingLayerToggles projectId={projectId} drawing={d} />
        </InspectorSection>
      )}

      {family !== "vector" && d.status === "ready" && (
        <InspectorSection title="Display">
          <Switch
            label="Knock out white"
            checked={d.layer_state.knockout_white}
            onChange={() => void toggleKnockout(api, projectId, d)}
          />
        </InspectorSection>
      )}

      {confirmClear && (
        <Dialog
          open
          title="Clear placement?"
          description="The drawing goes back to not placed; its control points are deleted."
          onClose={() => setConfirmClear(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmClear(false)} disabled={busy === "clear"}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void clear()} loading={busy === "clear"}>
                Clear placement
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">{d.name}</p>
        </Dialog>
      )}
    </div>
  );
}
