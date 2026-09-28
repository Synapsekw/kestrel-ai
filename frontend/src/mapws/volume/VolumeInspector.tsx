import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { components } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { pushLog } from "@/app/diagnostics";
import { createVolumeExport } from "@/api/volumes";
import { relativeTime } from "@/findings/format";
import { useNow } from "@/jobs/useNow";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { useTools, useWorkspace, type InspectorBodyProps } from "@/mapws/w4host";
import { useJobsStore } from "@/store/jobs";
import {
  Alert,
  Button,
  Disclosure,
  Field,
  Input,
  InspectorPane,
  InspectorSection,
  Pill,
  Progress,
  Skeleton,
  SkeletonRows,
  Switch,
  buttonClass,
  cx,
  toast,
} from "@/ui";
import { AlignmentSection } from "@/volumes/AlignmentSection";
import { MasksSection } from "@/volumes/MasksSection";
import {
  formatM2,
  formatM3,
  formatTonnes,
  labels,
  staleText,
  tonnage,
  uncertaintyText,
  viewIn3dHref,
} from "@/volumes/model";
import { BaseCards } from "./BaseCards";
import { baseCards } from "./baseCardsModel";
import { useVolume } from "./useVolume";
import { volumeViewHref } from "./volumeActions";
import { DIFF_CUT_HEX, DIFF_FILL_HEX, sameFrame } from "./volumeModel";
import { useVolumeStore } from "./volumeStore";

type VolumeBase = components["schemas"]["VolumeBase"];
const STATUS_TONE = {
  ready: "ok",
  stale: "warn",
  calculating: "neutral",
  failed: "danger",
} as const;
const STATUS_TEXT = {
  ready: "Ready",
  stale: "Stale",
  calculating: "Calculating",
  failed: "Failed",
} as const;
const STABLE_NEEDS_SURFACE = "A stable area needs a base surface from another survey.";
const swatch = (hex: string) => ({ "--c": hex }) as CSSProperties;

/** The mockup's volume inspector (spec §5.3, §10). Numbers only ever come from a volume_calc job. */
export function VolumeInspector({ selection, projectId, frame }: InspectorBodyProps) {
  const api = useApi();
  const l = useWorkspace((s) => s.l);
  const { m, surfaces, top, error, save, recalc, reload } = useVolume(projectId, selection.id);
  const autoRecalc = useVolumeStore((s) => s.autoRecalc);
  const setAutoRecalc = useVolumeStore((s) => s.setAutoRecalc);
  const heatmap = useVolumeStore((s) => s.heatmap);
  const setHeatmap = useVolumeStore((s) => s.setHeatmap);
  const drawing = useVolumeStore((s) => s.drawing);
  const setDrawing = useVolumeStore((s) => s.setDrawing);
  const activate = useTools((s) => s.activate);
  // Masks are drawn with W1's drawing pipeline: the "volume" tool, which keeps the selection (T8-2).
  const toggleMask = (kind: "stable" | "exclusion") => {
    const next = drawing === kind ? null : kind;
    setDrawing(next);
    activate(next ? "volume" : "select");
  };
  const { job } = useTrackedJob(projectId, m?.status === "calculating" ? m.job_id : null);
  const nowMs = useNow(60_000);
  const [name, setName] = useState<string | null>(null);
  const [material, setMaterial] = useState<{
    name: string;
    density: string;
  } | null>(null);

  // A background load failure shows inline with a retry, never as a toast (T16-1).
  const loadError = error && (
    <Alert tone="danger">
      {error}
      <Button size="sm" className="mt-2" onClick={reload}>
        Retry
      </Button>
    </Alert>
  );
  if (!m && loadError)
    return (
      <InspectorPane label="Volume measurement">
        <InspectorSection key="error" title="Volume measurement">
          {loadError}
        </InspectorSection>
      </InspectorPane>
    );
  // useVolume sets the measurement and the surfaces together: a missing top was deleted.
  if (m && !top)
    return (
      <InspectorPane label="Volume measurement">
        <InspectorSection key="error" title="Volume measurement">
          <Alert tone="danger">
            The top surface of this measurement is gone. Open it in the Measurements view to pick another one.{" "}
            <Link className="text-accent-ink underline" to={volumeViewHref(projectId, m.id)}>
              Open it there
            </Link>
          </Alert>
        </InspectorSection>
      </InspectorPane>
    );
  if (!m || !top)
    return (
      <InspectorPane label="Volume measurement" header={<Skeleton className="h-4 w-28" />}>
        <SkeletonRows rows={6} columns={1} />
      </InspectorPane>
    );

  const calculating = m.status === "calculating";
  const r = m.results;
  const lab = labels(m.base.kind, r?.base_surface);
  const cards = baseCards({ measurement: m, top, surfaces, l });
  const drawable = sameFrame(frame, top);
  const tons = tonnage(m);
  const mat = material ?? {
    name: m.material?.name ?? "",
    density: m.material ? String(m.material.density_t_m3) : "",
  };
  const href = viewIn3dHref(projectId, top, m.polygon_native);
  const baseSurface =
    m.base.kind === "surface" ? (surfaces.find((s) => s.id === m.base.surface_id) ?? null) : null;
  const fill = r?.fill_m3 ?? 0;
  const cut = r?.cut_m3 ?? 0;

  const onBase = (base: VolumeBase) =>
    save({
      base:
        base.kind === "flat" && base.z == null
          ? { kind: "flat", z: top.stats?.z_p02 ?? top.z_min ?? 0 }
          : base,
    });
  const matName = mat.name.trim();
  const matDensity = Number(mat.density);
  // An incomplete draft is kept and says what is missing instead of silently doing nothing.
  const materialHint =
    material === null || (!matName && !mat.density)
      ? null
      : !(matDensity > 0)
        ? "Enter a density above 0 to save the material."
        : !matName
          ? "Enter a material name to save it."
          : null;
  const saveMaterial = () => {
    if (!matName && !mat.density) {
      if (m.material) save({ material: null });
      setMaterial(null);
      return;
    }
    if (!matName || !(matDensity > 0)) return;
    const same = m.material?.name === matName && m.material.density_t_m3 === matDensity;
    if (!same) save({ material: { name: matName, density_t_m3: matDensity } });
    setMaterial(null);
  };
  const exportCsv = () =>
    createVolumeExport(api, projectId, {
      measurement_ids: [m.id],
      formats: ["csv"],
    })
      .then((j) => {
        useJobsStore.getState().upsert(j);
        toast("info", "Exporting the CSV — it appears under Jobs when ready.");
      })
      .catch((err: unknown) => {
        const message = messageOf(err, "could not start the export");
        pushLog(`start the volume export failed: ${message}`);
        toast("danger", message);
      });

  return (
    <InspectorPane
      label="Volume measurement"
      header={
        <div className="flex w-full items-center gap-2" data-testid="volume-inspector">
          <Pill size="sm" tone="accent">
            Volume
          </Pill>
          <Pill size="sm" tone={STATUS_TONE[m.status]} live={calculating}>
            {STATUS_TEXT[m.status]}
          </Pill>
        </div>
      }
      footer={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon="download" onClick={exportCsv} disabled={m.status !== "ready"}>
            Export CSV
          </Button>
          {href ? (
            <Link to={href} className={buttonClass("secondary", "sm")}>
              View in 3D
            </Link>
          ) : (
            <Button size="sm" disabled title="This surface has no point cloud to open">
              View in 3D
            </Button>
          )}
        </div>
      }
    >
      <InspectorSection key="identity" title="Volume measurement">
        <div className="flex flex-col gap-2">
          {loadError}
          <Input
            aria-label="Name"
            value={name ?? m.name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              if (name && name.trim() && name !== m.name) save({ name: name.trim() });
              setName(null);
            }}
          />
          <p className="text-xs text-muted">
            {m.material ? `${m.material.name} · ${m.material.density_t_m3} t/m³ · ` : ""}
            {r ? `calculated ${relativeTime(r.computed_at, nowMs)}` : "not calculated yet"} · top {top.name}
          </p>
        </div>
      </InspectorSection>

      <InspectorSection key="base" title="Base surface">
        <BaseCards cards={cards} busy={calculating} measurement={m} onBase={onBase} />
      </InspectorSection>

      <InspectorSection key="numbers" title="Net volume">
        <div
          data-testid={calculating ? "volume-calculating" : "volume-numbers"}
          className={cx(
            "flex flex-col gap-2 transition-opacity duration-fast reduce-motion:transition-none",
            calculating && "opacity-50",
          )}
        >
          <p data-testid="volume-net" className="text-kpi tabular-nums text-ink">
            {formatM3(r?.net_m3)}
          </p>
          {r && (
            <p className="text-xs text-muted">
              {uncertaintyText(r.uncertainty)} · cell {(r.cell_size_m * 100).toFixed(0)} cm
            </p>
          )}
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-muted">{lab.fill}</dt>
            <dd className="text-right tabular-nums text-ink">{formatM3(r?.fill_m3)}</dd>
            <dt className="text-muted">{lab.cut}</dt>
            <dd className="text-right tabular-nums text-ink">{formatM3(r?.cut_m3)}</dd>
          </dl>
          {r && fill + cut > 0 && (
            <div aria-hidden="true" className="flex h-2 overflow-hidden rounded-chip bg-surface-2">
              <span
                className="h-full bg-[color:var(--c)]"
                style={{ ...swatch(DIFF_FILL_HEX), flexGrow: fill }}
              />
              <span
                className="h-full bg-[color:var(--c)]"
                style={{ ...swatch(DIFF_CUT_HEX), flexGrow: cut }}
              />
            </div>
          )}
        </div>
        {calculating && (
          <div className="mt-2 flex flex-col gap-1">
            <Progress value={job?.progress} running label="Calculating the volume" />
            {job?.message && <p className="text-xs text-muted">{job.message}</p>}
          </div>
        )}
        {m.status === "stale" && (
          <Alert tone="warn">
            {staleText(m.stale_reasons)}
            {/* Always offered: staleness from outside (a rebuilt surface, a deleted masked finding)
                is never recalculated on its own, auto-recalculate or not. */}
            <Button size="sm" className="mt-2" onClick={recalc}>
              Recalculate
            </Button>
          </Alert>
        )}
        {m.status === "failed" && (
          <Alert tone="danger">
            {m.error ?? "The calculation failed."}
            <Button size="sm" className="mt-2" onClick={recalc}>
              Recalculate
            </Button>
          </Alert>
        )}
        {r?.warnings.map((w) => (
          <Alert key={w.code} tone={w.severity === "danger" ? "danger" : "warn"}>
            {w.message}
          </Alert>
        ))}
      </InspectorSection>

      <InspectorSection key="stats" title="Stats">
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted">Footprint area</dt>
          <dd className="text-right tabular-nums">{formatM2(r?.polygon_area_m2)}</dd>
          <dt className="text-muted">Measured area</dt>
          <dd className="text-right tabular-nums">{formatM2(r?.measured_area_m2)}</dd>
          <dt className="text-muted">No data</dt>
          <dd className="text-right tabular-nums">{formatM2(r?.nodata_area_m2)}</dd>
          <dt className="text-muted">Tonnage{m.material ? ` @ ${m.material.density_t_m3} t/m³` : ""}</dt>
          <dd className="text-right tabular-nums">{formatTonnes(tons)}</dd>
        </dl>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Field label="Material" htmlFor="volume-material">
            <Input
              id="volume-material"
              value={mat.name}
              onChange={(e) => setMaterial({ ...mat, name: e.target.value })}
              onBlur={saveMaterial}
            />
          </Field>
          <Field label="Density (t/m³)" htmlFor="volume-density">
            <Input
              id="volume-density"
              type="number"
              min={0.1}
              step={0.05}
              value={mat.density}
              onChange={(e) => setMaterial({ ...mat, density: e.target.value })}
              onBlur={saveMaterial}
            />
          </Field>
        </div>
        {materialHint && <p className="mt-1 text-xs text-muted">{materialHint}</p>}
      </InspectorSection>

      <InspectorSection key="display" title="Display">
        <div className="flex flex-col gap-2">
          <Switch label="Cut / fill heatmap" checked={heatmap} onChange={setHeatmap} />
          {heatmap && (
            <p className="flex items-center gap-3 text-xs text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm bg-[color:var(--c)]" style={swatch(DIFF_FILL_HEX)} />
                above base
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-3 rounded-sm bg-[color:var(--c)]" style={swatch(DIFF_CUT_HEX)} />
                below base
              </span>
            </p>
          )}
          <Switch label="Recalculate automatically" checked={autoRecalc} onChange={setAutoRecalc} />
        </div>
      </InspectorSection>

      <InspectorSection key="masks" title="Masks">
        <Disclosure label="Masks & alignment">
          <div className="flex flex-col gap-3 pt-2">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                disabled={!drawable || m.base.kind !== "surface"}
                title={m.base.kind !== "surface" ? STABLE_NEEDS_SURFACE : undefined}
                aria-pressed={drawing === "stable"}
                onClick={() => toggleMask("stable")}
              >
                Draw stable area
              </Button>
              <Button
                size="sm"
                disabled={!drawable}
                aria-pressed={drawing === "exclusion"}
                onClick={() => toggleMask("exclusion")}
              >
                Draw exclusion
              </Button>
            </div>
            {drawable && m.base.kind !== "surface" && (
              <p className="text-xs text-muted">{STABLE_NEEDS_SURFACE}</p>
            )}
            {!drawable && (
              <p className="text-xs text-muted">
                Draw masks in the Measurements view: this surface is in another CRS than the map.{" "}
                <Link className="text-accent-ink underline" to={volumeViewHref(projectId, m.id)}>
                  Open it there
                </Link>
              </p>
            )}
            {m.base.kind === "surface" && (
              <AlignmentSection
                measurement={m}
                onSave={save}
                drawHint="Draw a stable area on ground that did not change between the surveys."
              />
            )}
            <MasksSection
              projectId={projectId}
              measurement={m}
              top={top}
              baseSurface={baseSurface}
              onSave={save}
            />
          </div>
        </Disclosure>
      </InspectorSection>
    </InspectorPane>
  );
}
