import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import type { PointCloud } from "@/api/clouds";
import { formatPoints } from "@/clouds/format";
import { BUDGETS } from "@/clouds/viewer/budget";
import { ASPRS_CLASSES, classLabel } from "@/clouds/viewer/classes";
import { POINT_SIZE_MAX, POINT_SIZE_MIN, defaultElevationRange } from "@/clouds/viewer/materialOptions";
import type { ColourAvailability } from "@/clouds/viewer/types";
import {
  Button,
  Field,
  GlassPanel,
  Icon,
  Input,
  Pill,
  Popover,
  Segmented,
  Slider,
  Switch,
  cx,
  focusRing,
  stagger,
  transition,
} from "@/ui";
import { CLOUD_PANEL_WIDTH } from "./layout";
import type { RenderSettings } from "./types";

const TONE = { ready: "ok", importing: "accent", failed: "danger" } as const;
/** potree's VIRIDIS gradient, the elevation ramp (colours from data go through `style`). */
const VIRIDIS = "linear-gradient(90deg, #440154, #414487, #2a788e, #22a884, #7ad151, #fde725)";
const GREY = "linear-gradient(90deg, #111111, #eeeeee)";
const OTHER_RGB: [number, number, number] = [77, 153, 153];
const count = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });

function CloudPicker({
  projectId,
  cloud,
  clouds,
  onImport,
  onDetails,
}: {
  projectId: string;
  cloud: PointCloud;
  clouds: readonly PointCloud[];
  onImport(): void;
  onDetails(): void;
}) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const file = cloud.source_path.split(/[\\/]/).pop() ?? cloud.source_path;
  const title = [
    cloud.name,
    cloud.captured_on,
    cloud.point_count != null ? formatPoints(cloud.point_count) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <button
        ref={anchor}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Point cloud: ${title}. Choose another`}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-control border border-line bg-field px-2.5 py-2 text-left hover:border-line-strong",
          transition,
          focusRing,
        )}
      >
        <span aria-hidden className="h-[30px] w-[30px] shrink-0 rounded-sm bg-grad-primary" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">{title}</span>
          <span className="block truncate text-xs text-muted">
            {file}
            {cloud.las_version ? ` · LAS ${cloud.las_version}` : ""}
          </span>
        </span>
        <Icon name="chevron-down" />
      </button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={anchor}
        label="Point clouds"
        className="w-[300px] p-2"
      >
        <ul aria-label="Point clouds" className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
          {clouds.map((c) => (
            <li key={c.id}>
              <Link
                to={`/p/${projectId}/clouds/${c.id}`}
                onClick={() => setOpen(false)}
                aria-current={c.id === cloud.id ? "page" : undefined}
                className={cx(
                  "flex items-center gap-2 rounded-control px-2 py-1.5 text-sm",
                  transition,
                  focusRing,
                  c.id === cloud.id ? "bg-accent-soft" : "hover:bg-hover",
                )}
              >
                <span className="min-w-0 flex-1 truncate text-ink">{c.name}</span>
                <span className="text-xs tabular-nums text-muted">
                  {c.point_count != null ? formatPoints(c.point_count) : "—"}
                </span>
                <Pill size="sm" tone={TONE[c.status]}>
                  {c.status}
                </Pill>
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-2 flex flex-wrap gap-2 border-t border-line pt-2">
          <Button
            size="sm"
            icon="import"
            onClick={() => {
              setOpen(false);
              onImport();
            }}
          >
            Import point cloud…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon="info"
            onClick={() => {
              setOpen(false);
              onDetails();
            }}
          >
            Details…
          </Button>
        </div>
      </Popover>
    </>
  );
}

/**
 * The cloud picker and the render rows. `embedded`: the body of the rail's Layers topic (spec §3.2),
 * no shell of its own. Otherwise (importing, failed, no view yet) its own glass panel at left 72,
 * top 14, the rail panel's 340 wide, padding 12, gap 11.
 */
export function CloudPanel({
  projectId,
  cloud,
  clouds,
  onImport,
  onDetails,
  embedded = false,
  children,
}: {
  projectId: string;
  cloud: PointCloud;
  clouds: readonly PointCloud[];
  onImport(): void;
  onDetails(): void;
  embedded?: boolean;
  children?: ReactNode;
}) {
  const body = (
    <>
      <CloudPicker
        projectId={projectId}
        cloud={cloud}
        clouds={clouds}
        onImport={onImport}
        onDetails={onDetails}
      />
      {children}
    </>
  );
  if (embedded)
    return (
      <div data-testid="cloud-panel" className="flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto">
        {body}
      </div>
    );
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      as="section"
      aria-label="Point cloud"
      data-testid="cloud-panel"
      style={{ ...stagger(1), width: CLOUD_PANEL_WIDTH }}
      className="stagger absolute left-[72px] top-3.5 z-10 flex max-h-[calc(100%-28px)] flex-col gap-[11px] overflow-y-auto p-3 animate-reveal reduce-motion:animate-none"
    >
      {body}
    </GlassPanel>
  );
}

function Legend({
  cloud,
  render,
  onRender,
  hiddenClasses,
  onToggleClass,
}: {
  cloud: PointCloud;
  render: RenderSettings;
  onRender(r: RenderSettings): void;
  hiddenClasses: ReadonlySet<number>;
  onToggleClass(code: number): void;
}) {
  const [lo, hi] = render.elevationRange;
  if (render.colour === "rgb") return <p className="text-xs text-muted">True colour</p>;
  if (render.colour === "intensity")
    return (
      <div className="flex flex-col gap-1">
        <span aria-hidden className="h-1.5 rounded-full" style={{ backgroundImage: GREY }} />
        <div className="flex justify-between font-mono text-2xs text-dim">
          <span>low · p2</span>
          <span>p98 · high</span>
        </div>
      </div>
    );
  if (render.colour === "classification") {
    const codes = Object.entries(cloud.class_counts ?? {})
      .map(([k, n]) => [Number(k), Number(n)] as const)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 16);
    return (
      <ul aria-label="Classes" className="flex flex-wrap gap-1">
        {codes.map(([code, n]) => {
          const rgb = ASPRS_CLASSES.find((c) => c.code === code)?.rgb ?? OTHER_RGB;
          const shown = !hiddenClasses.has(code);
          return (
            <li key={code}>
              <button
                type="button"
                aria-pressed={shown}
                onClick={() => onToggleClass(code)}
                className={cx(
                  "flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-2xs",
                  shown ? "text-ink" : "text-dim line-through",
                  transition,
                  focusRing,
                )}
              >
                <span
                  aria-hidden
                  className="h-2 w-2 rounded-full"
                  style={{ background: `rgb(${rgb.join(",")})` }}
                />
                {classLabel(code)}
                <span className="font-mono text-dim">{count.format(n)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <span aria-hidden className="h-1.5 rounded-full" style={{ backgroundImage: VIRIDIS }} />
      <div className="flex justify-between font-mono text-2xs text-dim">
        <span>{lo.toFixed(1)} m</span>
        <span>{hi.toFixed(1)} m</span>
      </div>
      <div className="flex items-end gap-2">
        <Field label="Lowest" htmlFor="cloud-zlo">
          <Input
            id="cloud-zlo"
            type="number"
            step="0.1"
            value={lo}
            onChange={(e) => onRender({ ...render, elevationRange: [Number(e.target.value), hi] })}
          />
        </Field>
        <Field label="Highest" htmlFor="cloud-zhi">
          <Input
            id="cloud-zhi"
            type="number"
            step="0.1"
            value={hi}
            onChange={(e) => onRender({ ...render, elevationRange: [lo, Number(e.target.value)] })}
          />
        </Field>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onRender({ ...render, elevationRange: defaultElevationRange(cloud) })}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}

/** Colour by, the ramp and legend, point size, point budget, EDL (spec §6 cloud panel rows 2–6). */
export function RenderControls({
  cloud,
  render,
  onRender,
  availability,
  hiddenClasses,
  onToggleClass,
  pointsShown,
}: {
  cloud: PointCloud;
  render: RenderSettings;
  onRender(r: RenderSettings): void;
  availability: ColourAvailability | null;
  hiddenClasses: ReadonlySet<number>;
  onToggleClass(code: number): void;
  pointsShown: number | null;
}) {
  const set = (patch: Partial<RenderSettings>) => onRender({ ...render, ...patch });
  const a = availability;
  const missing = a ? (["intensity", "classification"] as const).filter((k) => !a[k]) : [];
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-xs text-muted">Colour by</span>
        <Segmented
          label="Colour by"
          size="sm"
          value={render.colour}
          onChange={(colour) => set({ colour })}
          options={[
            { value: "rgb", label: "RGB", disabled: !(a?.rgb ?? cloud.has_rgb) },
            { value: "elevation", label: "Elevation" },
            { value: "intensity", label: "Intensity", disabled: !a?.intensity },
            { value: "classification", label: "Class", disabled: !a?.classification },
          ]}
        />
        {missing.length > 0 && (
          <p className="text-xs text-muted">This cloud has no {missing.join(" or ")}.</p>
        )}
      </div>
      <Legend
        cloud={cloud}
        render={render}
        onRender={onRender}
        hiddenClasses={hiddenClasses}
        onToggleClass={onToggleClass}
      />
      <Slider
        label="Point size"
        min={POINT_SIZE_MIN}
        max={POINT_SIZE_MAX}
        step={0.1}
        value={render.pointSize}
        onChange={(pointSize) => set({ pointSize })}
        format={(v) => `${v.toFixed(1)} px`}
      />
      <div className="flex flex-col gap-1">
        <Slider
          label="Point budget"
          min={BUDGETS[0]}
          max={BUDGETS[BUDGETS.length - 1]}
          stops={BUDGETS}
          value={render.budget}
          onChange={(budget) => set({ budget })}
          format={(v) => `${v / 1e6} M`}
        />
        <span data-testid="cloud-points-shown" className="text-right font-mono text-2xs text-muted">
          {((pointsShown ?? 0) / 1e6).toFixed(1)} M shown
        </span>
      </div>
      <Switch label="EDL shading" checked={render.edl} onChange={(edl) => set({ edl })} />
    </>
  );
}
