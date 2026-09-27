/* eslint-disable react-refresh/only-export-components -- pickReadoutRow is a pure helper tested with it. */
import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/api/client";
import { useWorkspace } from "../context";
import { RASTER_KINDS, useRasterLayers } from "../data/useRasterLayers";
import { useGoneLayers } from "../layers/goneLayers";
import type { LayerRow } from "../layers/layerRegistry";
import { effectiveState, orderRows } from "../layers/placement";
import { elevationRows } from "../layers/rasterRows";
import type { PanelProps } from "../panels/panelRegistry";
import type { LayerUserState } from "../state/workspaceStore";
import { sampleInFrame } from "./sampleApi";
import { SAMPLE_INTERVAL_MS, createThrottledSampler } from "./throttledSampler";

/** Ruling W2-5: the topmost visible elevation row dated r; undated designs never count. */
export function pickReadoutRow(
  rows: readonly LayerRow[],
  order: readonly string[] | undefined,
  state: Record<string, LayerUserState>,
  r: string | null,
  gone: ReadonlySet<string>,
): LayerRow | null {
  if (r === null) return null;
  const kind = RASTER_KINDS.get("surface");
  return (
    orderRows(rows, order).find(
      (row) => row.date === r && !gone.has(row.key) && effectiveState(row, kind, state).visible,
    ) ?? null
  );
}

function ReadoutValue({ projectId, row }: { projectId: string; row: LayerRow }) {
  const api = useApi();
  const pointer = useWorkspace((s) => s.pointer);
  const [z, setZ] = useState<number | null>(null);
  const sampler = useMemo(
    () =>
      createThrottledSampler({
        intervalMs: SAMPLE_INTERVAL_MS,
        sample: async (x, y, signal) => {
          const res = await sampleInFrame(api, projectId, { x, y, surface_ids: [row.id] }, signal);
          return res.samples.find((s) => s.surface_id === row.id)?.z ?? null;
        },
        onResult: setZ,
      }),
    [api, projectId, row.id],
  );
  useEffect(() => () => sampler.cancel(), [sampler]);
  useEffect(() => {
    if (pointer) sampler.push(pointer[0], pointer[1]);
  }, [sampler, pointer]);
  const shown = pointer && z !== null && Number.isFinite(z) ? `${z.toFixed(2)} m` : "—";
  return (
    <span
      data-testid="readout-z"
      title={`Elevation from ${row.name}`}
      className="font-mono text-xs tabular-nums text-ok"
    >
      {`Z ${shown}`}
    </span>
  );
}

/** M §5 Coordinates row 2: `Z` of the topmost visible elevation layer of the right date. */
export function ReadoutZ({ projectId }: PanelProps) {
  const layers = useRasterLayers();
  const order = useWorkspace((s) => s.order.elevation);
  const state = useWorkspace((s) => s.layerState);
  const r = useWorkspace((s) => s.r);
  const gone = useGoneLayers((s) => s.gone);
  const row = useMemo(
    () => pickReadoutRow(elevationRows({ layers: layers ?? [] }), order, state, r, gone),
    [layers, order, state, r, gone],
  );
  if (!row) return null;
  return <ReadoutValue key={row.id} projectId={projectId} row={row} />;
}
