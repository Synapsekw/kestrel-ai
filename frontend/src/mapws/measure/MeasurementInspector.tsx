import { useEffect, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useApi } from "@/api/client";
import { codeOf, isNotImplemented, messageOf } from "@/api/errors";
import {
  getMapMeasurement,
  patchMapMeasurement,
  type MapMeasurement,
  type MapMeasurementPatch,
} from "@/api/mapMeasurements";
import { useChangesStore } from "@/store/changes";
import {
  Alert,
  Button,
  Checkbox,
  InspectorSection,
  Pill,
  Skeleton,
  SkeletonRows,
  Textarea,
  cx,
  toast,
} from "@/ui";
import {
  useGoneLayers,
  useSiteLayers,
  useWorkspace,
  type CompareMode,
  type InspectorBodyProps,
  type WorkspaceLayer,
} from "@/mapws/annotations/bindings";
import { FramedBody } from "@/mapws/annotations/FramedBody";
import {
  KIND_LABEL,
  formatArea,
  formatDate,
  formatFraction,
  formatHeight,
  formatLength,
  formatScale,
  type MeasureKind,
} from "@/mapws/annotations/format";
import { NameField } from "@/mapws/annotations/NameField";
import { elevationLayers, seriesRole, type Shown } from "@/mapws/annotations/pick";
import { ProfileChart, type ChartSeries } from "@/mapws/inspect/ProfileChart";
import { removeMeasurement } from "./actions";
import { useProfileHover } from "./profileHover";
import { ProfileSheet } from "./ProfileSheet";
import { areaView, crsText, distanceView, profileView, vertexCount } from "./results";
import { useMeasurementsStore } from "./store";

interface Loaded {
  id: string;
  m: MapMeasurement | null;
  error: string | null;
}
type View = { l: string | null; r: string | null; mode: CompareMode };

/**
 * A PATCH answer over the loaded row. PATCH takes no `frame`, so its answer may lack `vertices_site`:
 * the loaded site geometry stays (M-W3 P6); every other field is the server's latest.
 */
function mergeSaved(prev: MapMeasurement, saved: MapMeasurement): MapMeasurement {
  return { ...prev, ...saved, vertices_site: saved.vertices_site ?? prev.vertices_site };
}

function Figures({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-mono tabular-nums text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Primary({ value, note }: { value: string; note: string }) {
  return (
    <div>
      <p className="font-mono text-xl tabular-nums text-ink">{value}</p>
      <p className="text-2xs text-muted">{note}</p>
    </div>
  );
}

const basisNote = (basis: "ellipsoidal" | "local") =>
  basis === "local" ? "Local metres, on the grid" : "On the ellipsoid (WGS 84)";

function NoteField({ initial, onSave }: { initial: string; onSave: (note: string | null) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <Textarea
      aria-label="Note"
      rows={2}
      maxLength={2000}
      value={value}
      placeholder="Add a note"
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        if (value !== initial) onSave(value.trim() ? value : null);
      }}
    />
  );
}

function DistanceSection({ m }: { m: MapMeasurement }) {
  const v = distanceView(m);
  const rows: [string, string][] = [];
  if (v.grid !== null) rows.push(["Grid", formatLength(v.grid)]);
  if (v.scale !== null) rows.push(["Scale factor", formatScale(v.scale)]);
  if (v.length3d !== null) rows.push(["3D length", formatLength(v.length3d)]);
  if (v.nodata) rows.push(["No elevation", formatFraction(v.nodata)]);
  return (
    <InspectorSection title="Length">
      <div className="flex flex-col gap-2">
        <Primary value={v.length === null ? "–" : formatLength(v.length)} note={basisNote(v.basis)} />
        {rows.length > 0 && <Figures rows={rows} />}
      </div>
    </InspectorSection>
  );
}

function AreaSection({ m }: { m: MapMeasurement }) {
  const v = areaView(m);
  const rows: [string, string][] = [];
  if (v.perimeter !== null) rows.push(["Perimeter", formatLength(v.perimeter)]);
  if (v.grid !== null) rows.push(["Grid area", formatArea(v.grid)]);
  if (v.scale !== null) rows.push(["Areal scale factor", formatScale(v.scale)]);
  return (
    <InspectorSection title="Area">
      <div className="flex flex-col gap-2">
        <Primary value={v.area === null ? "–" : formatArea(v.area)} note={basisNote(v.basis)} />
        {rows.length > 0 && <Figures rows={rows} />}
      </div>
    </InspectorSection>
  );
}

function chartSeries(m: MapMeasurement, layers: readonly WorkspaceLayer[], view: View): ChartSeries[] {
  return profileView(m).series.map((s) => ({
    id: s.surfaceId,
    label: s.label,
    role: seriesRole(s.surfaceId, layers, view),
    z: s.z,
  }));
}

function ProfileSections(props: {
  m: MapMeasurement;
  layers: readonly WorkspaceLayer[];
  view: View;
  shown: Shown;
  saving: boolean;
  cursor: number | null;
  onCursor: (index: number | null) => void;
  onSurfaces: (ids: string[]) => void;
  onExpand: () => void;
}) {
  const { m, layers, view, shown, saving, cursor, onCursor, onSurfaces, onExpand } = props;
  const v = profileView(m);
  const series = chartSeries(m, layers, view);
  const heights: [string, string][] = [];
  if (v.zMin !== null) heights.push(["Lowest", formatHeight(v.zMin)]);
  if (v.zMax !== null) heights.push(["Highest", formatHeight(v.zMax)]);
  if (v.zMin !== null && v.zMax !== null) heights.push(["Δz", formatHeight(v.zMax - v.zMin)]);
  if (v.cut !== null) heights.push(["Cut", formatArea(v.cut)]);
  if (v.fill !== null) heights.push(["Fill", formatArea(v.fill)]);
  if (v.nodata) heights.push(["No elevation", formatFraction(v.nodata)]);
  // W3-6: one to three surfaces, changed through PATCH `surface_ids`.
  const toggle = (sid: string) => {
    const next = m.surface_ids.includes(sid)
      ? m.surface_ids.filter((x) => x !== sid)
      : [...m.surface_ids, sid];
    if (next.length === 0) return void toast("info", "A profile needs at least one surface");
    if (next.length > 3) return void toast("info", "A profile draws at most three surfaces");
    onSurfaces(next);
  };
  return (
    <div className="flex flex-col gap-3.5">
      <InspectorSection
        title="Profile"
        action={
          <Button variant="ghost" size="sm" icon="fit" onClick={onExpand}>
            Expand
          </Button>
        }
      >
        <div aria-busy={saving} className={cx("transition-opacity duration-base", saving && "opacity-60")}>
          <ProfileChart stations={v.stations} series={series} cursor={cursor} onCursor={onCursor} />
        </div>
        {saving && <p className="mt-1 text-2xs text-muted">Recomputing…</p>}
        {series.length >= 2 && (v.cut !== null || v.fill !== null) && (
          <p className="mt-1 text-2xs text-muted">{`Cut and fill of ${series[1].label} against ${series[0].label}`}</p>
        )}
      </InspectorSection>
      {heights.length > 0 && (
        <InspectorSection title="Heights">
          <Figures rows={heights} />
        </InspectorSection>
      )}
      <InspectorSection title="Surfaces">
        <div className="flex flex-col gap-1.5">
          {elevationLayers(layers, shown).map((l) => (
            <Checkbox
              key={l.id}
              label={l.date ? `${l.name} · ${formatDate(l.date)}` : l.name}
              checked={m.surface_ids.includes(l.id)}
              disabled={saving}
              onChange={() => toggle(l.id)}
            />
          ))}
        </div>
      </InspectorSection>
    </div>
  );
}

/** Spec §5.3 "Distance / area" and "Profile". Every number is the server's `results` (M13). */
export function MeasurementInspector({ selection, projectId, onClose }: InspectorBodyProps) {
  const id = selection.id;
  const api = useApi();
  const revision = useChangesStore((s) => s.mapMeasurementsRevision);
  const layers = useSiteLayers();
  const view = useWorkspace(useShallow((s) => ({ l: s.l, r: s.r, mode: s.mode })));
  const visibility = useWorkspace(useShallow((s) => ({ layerState: s.layerState, order: s.order })));
  const gone = useGoneLayers((s) => s.gone);
  const hoverId = useProfileHover((s) => s.measurementId);
  const hoverIndex = useProfileHover((s) => s.index);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    let live = true;
    getMapMeasurement(api, projectId, id)
      .then((m) => {
        if (!live) return;
        setLoaded({ id, m, error: null });
        // A14: the layer's listed row has no stations; the full row makes the map↔chart hover work.
        useMeasurementsStore.getState().upsert(m);
      })
      .catch((e: unknown) => {
        if (!live) return;
        const error =
          codeOf(e) === "not_found"
            ? "This measurement was deleted."
            : isNotImplemented(e)
              ? "Measurements need the map measurement backend (M-B4)"
              : messageOf(e, "could not load the measurement");
        setLoaded({ id, m: null, error });
      });
    return () => {
      live = false;
    };
  }, [api, projectId, id, revision]);

  // Review Focus 4: an answer for another id never renders (the selection may change mid-read).
  const current = loaded && loaded.id === id ? loaded : null;
  const m = current?.m ?? null;

  async function save(base: MapMeasurement, patch: MapMeasurementPatch) {
    setSaving(true);
    try {
      const full = mergeSaved(base, await patchMapMeasurement(api, projectId, base.id, patch));
      setLoaded((prev) => (prev && prev.id === base.id ? { id: base.id, m: full, error: null } : prev));
      useMeasurementsStore.getState().upsert(full);
    } catch (e) {
      toast("danger", messageOf(e, "could not save the measurement"));
    } finally {
      setSaving(false);
    }
  }

  // W3-14: the inspector's Delete deletes at once; only W1's `Del` asks first (remove.confirm).
  async function remove(target: MapMeasurement) {
    try {
      await removeMeasurement(api, projectId, target.id);
      toast("ok", `${target.name} deleted`);
      onClose();
    } catch (e) {
      toast("danger", messageOf(e, "could not delete the measurement"));
    }
  }

  const header = <span className="text-xs text-muted">Selected measurement</span>;
  if (current?.error)
    return (
      <FramedBody header={header}>
        <Alert tone="danger">{current.error}</Alert>
      </FramedBody>
    );
  if (!m)
    return (
      <FramedBody header={<Skeleton className="h-4 w-28" />}>
        <SkeletonRows rows={5} columns={1} />
      </FramedBody>
    );

  const kind = m.kind as MeasureKind;
  const cursor = hoverId === m.id ? hoverIndex : null;
  const onCursor = (i: number | null) => useProfileHover.getState().set(i === null ? null : m.id, i);
  const shown: Shown = { ...visibility, gone };

  return (
    <>
      <FramedBody
        header={
          <div className="flex min-w-0 items-center gap-2">
            {header}
            <Pill size="sm" tone="accent">
              {KIND_LABEL[kind]}
            </Pill>
          </div>
        }
        footer={
          <Button
            variant="danger"
            size="sm"
            icon="trash"
            className="w-full justify-center"
            onClick={() => void remove(m)}
          >
            Delete
          </Button>
        }
      >
        <InspectorSection title="Name">
          <NameField key={`${m.id}:${m.name}`} initial={m.name} onSave={(name) => void save(m, { name })} />
        </InspectorSection>
        {m.kind === "distance" && <DistanceSection m={m} />}
        {m.kind === "area" && <AreaSection m={m} />}
        {m.kind === "profile" && (
          <ProfileSections
            m={m}
            layers={layers}
            view={view}
            shown={shown}
            saving={saving}
            cursor={cursor}
            onCursor={onCursor}
            onSurfaces={(surface_ids) => void save(m, { surface_ids })}
            onExpand={() => setSheet(true)}
          />
        )}
        <InspectorSection title="Note">
          <NoteField key={`${m.id}:note`} initial={m.note ?? ""} onSave={(note) => void save(m, { note })} />
        </InspectorSection>
        <InspectorSection title="Geometry">
          <Figures
            rows={[
              ["Vertices", String(vertexCount(m))],
              ["CRS", crsText(m)],
            ]}
          />
        </InspectorSection>
      </FramedBody>
      {sheet && m.kind === "profile" && (
        <ProfileSheet
          title={m.name}
          stations={profileView(m).stations}
          series={chartSeries(m, layers, view)}
          cursor={cursor}
          onCursor={onCursor}
          onClose={() => setSheet(false)}
        />
      )}
    </>
  );
}
