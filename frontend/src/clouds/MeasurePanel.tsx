import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/api/client";
import type { PointCloud } from "@/api/clouds";
import {
  createCloudMeasurement,
  deleteCloudMeasurement,
  listCloudMeasurements,
  updateCloudMeasurement,
  type CloudMeasurement,
} from "@/api/cloudMeasurements";
import { messageOf } from "@/api/errors";
import { Alert, Button, IconButton, Input, cx, toast } from "@/ui";
import {
  KIND_LABEL,
  isGeographic,
  refusal,
  results,
  type MeasureKind,
  type MPoint,
  type Results,
} from "./measure";
import { measurementsCsv } from "./measureCsv";
import { formatLength, makePickReadout } from "./readout";
import type { MeasureTool } from "./useMeasureTool";

const KINDS: MeasureKind[] = ["point", "distance", "height", "vertical"];
const HELP =
  "For inspection. A pick is a real point of the file, but the true surface point can be up to ± the pick uncertainty away; zoom in to shrink it. Volumes never come from the 3D view.";

function ResultRows({ kind, r }: { kind: MeasureKind; r: Results }) {
  const rows: [string, string][] =
    kind === "point"
      ? []
      : kind === "vertical"
        ? [
            ["Horizontal offset", formatLength(r.lean_offset_m ?? 0)],
            [
              "Lean",
              `${(r.lean_angle_deg ?? 0).toFixed(3)}° ± ${(r.angle_uncertainty_deg ?? 0).toFixed(3)}°`,
            ],
            ["Lean direction", `${(r.lean_azimuth_deg ?? 0).toFixed(1)}° from grid north`],
            ["Lean ratio", `${(r.lean_mm_per_m ?? 0).toFixed(1)} mm/m`],
            ["Height", formatLength(r.distance_vertical ?? 0)],
          ]
        : kind === "height"
          ? [
              [
                "Height difference",
                `${(r.height_difference ?? 0) >= 0 ? "+" : "−"}${formatLength(Math.abs(r.height_difference ?? 0))}`,
              ],
              ["Horizontal", formatLength(r.distance_horizontal ?? 0)],
            ]
          : [
              ["3D distance", formatLength(r.distance_3d ?? 0)],
              ["Horizontal", formatLength(r.distance_horizontal ?? 0)],
              ["Vertical", formatLength(r.distance_vertical ?? 0)],
            ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right tabular-nums text-ink">{v}</dd>
        </div>
      ))}
      <dt className="text-muted">Uncertainty</dt>
      <dd className="text-right tabular-nums text-ink">± {formatLength(r.uncertainty_m ?? 0)}</dd>
    </dl>
  );
}

export function MeasurePanel({
  projectId,
  cloud,
  tool,
  onFlyTo,
}: {
  projectId: string;
  cloud: PointCloud;
  tool: MeasureTool;
  onFlyTo(p: MPoint): void;
}) {
  const api = useApi();
  const [items, setItems] = useState<CloudMeasurement[]>([]);
  const [error, setError] = useState<string | null>(null);
  const geographic = isGeographic(cloud);
  const readout = useMemo(() => makePickReadout(cloud), [cloud]);
  useEffect(() => {
    // A late answer for an earlier cloud or project never overwrites the current list.
    let current = true;
    void listCloudMeasurements(api, projectId, cloud.id)
      .then((xs) => current && setItems(xs))
      .catch((e: unknown) => current && setError(messageOf(e, "could not load the measurements")));
    return () => {
      current = false;
    };
  }, [api, projectId, cloud.id]);

  const points: MPoint[] = tool.picks.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z,
    uncertainty_m: p.uncertainty_m,
  }));
  const live = tool.complete && tool.tool ? results(tool.tool, points) : null;
  const blocked = tool.tool ? refusal(tool.tool, points, geographic) : null;
  const last = tool.picks[tool.picks.length - 1] ?? tool.hover;
  const r = last ? readout(last) : null;

  const replace = (u: CloudMeasurement) => {
    setItems((xs) => xs.map((x) => (x.id === u.id ? u : x)));
    setError(null);
  };
  /** Saves a rename or note on blur; on failure the field goes back to what the server holds. */
  const patch = (
    input: HTMLInputElement,
    m: CloudMeasurement,
    body: { name: string } | { note: string | null },
    serverValue: string,
    what: string,
  ) =>
    void updateCloudMeasurement(api, projectId, cloud.id, m.id, body)
      .then(replace)
      .catch((e: unknown) => {
        input.value = serverValue;
        setError(messageOf(e, `could not ${what}`));
      });
  const remove = (m: CloudMeasurement) =>
    void deleteCloudMeasurement(api, projectId, cloud.id, m.id)
      .then(() => {
        setItems((xs) => xs.filter((x) => x.id !== m.id));
        setError(null);
      })
      .catch((e: unknown) => setError(messageOf(e, "could not delete the measurement")));

  const save = () => {
    if (!tool.tool || !tool.complete || blocked) return;
    void createCloudMeasurement(api, projectId, cloud.id, { kind: tool.tool, points })
      .then((m) => {
        setItems((xs) => [...xs, m]);
        setError(null);
      })
      .catch((e: unknown) => setError(messageOf(e, "could not save the measurement")));
  };

  return (
    <div className="flex flex-col gap-4">
      {geographic && (
        <Alert tone="warn">distances need a projected coordinate system; this cloud is in degrees</Alert>
      )}
      <div className="grid grid-cols-2 gap-1.5" role="group" aria-label="Measuring tools">
        {KINDS.map((k) => (
          <Button
            key={k}
            size="sm"
            variant={tool.tool === k ? "primary" : "secondary"}
            aria-pressed={tool.tool === k}
            disabled={k !== "point" && geographic}
            onClick={() => (tool.tool === k ? tool.cancel() : tool.arm(k))}
          >
            {KIND_LABEL[k]}
          </Button>
        ))}
      </div>
      <p className="text-xs text-muted">
        {tool.tool
          ? `Click ${tool.tool === "point" ? "a point" : "two points"} in the view · Esc cancels`
          : HELP}
      </p>
      {r && (
        <div
          className="flex flex-col gap-0.5 rounded-md bg-well p-2.5 text-xs tabular-nums"
          data-testid="pick-readout"
        >
          <span className="text-ink">{r.native}</span>
          {r.wgs84 && <span className="text-muted">{r.wgs84}</span>}
          <span className="text-muted">{r.zLabel}</span>
          <span className={cx(r.warn ? "text-warn" : "text-muted")}>{r.precision}</span>
        </div>
      )}
      {live && !blocked && tool.tool && <ResultRows kind={tool.tool} r={live} />}
      {blocked && tool.complete && <Alert tone="warn">{blocked}</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
      <Button variant="primary" disabled={!tool.complete || !!blocked} onClick={save}>
        Save
      </Button>
      <div className="flex items-center justify-between border-t border-line pt-3">
        <h3 className="text-sm font-semibold">Saved</h3>
        <Button
          size="sm"
          variant="ghost"
          disabled={items.length === 0}
          onClick={() =>
            void navigator.clipboard
              .writeText(measurementsCsv(items))
              .then(() => toast("ok", `Copied ${items.length} measurement${items.length === 1 ? "" : "s"}`))
              .catch(() => toast("danger", "could not copy to the clipboard"))
          }
        >
          Copy all as CSV
        </Button>
      </div>
      <ul className="flex flex-col gap-2" aria-label="Saved measurements">
        {items.map((m) => {
          const res = m.results as Results;
          const main =
            m.kind === "point"
              ? `E ${m.points[0].x.toFixed(3)} N ${m.points[0].y.toFixed(3)}`
              : m.kind === "vertical"
                ? `${(res.lean_angle_deg ?? 0).toFixed(3)}° lean`
                : m.kind === "height"
                  ? formatLength(Math.abs(res.height_difference ?? 0))
                  : formatLength(res.distance_3d ?? 0);
          return (
            <li key={m.id} className="flex flex-col gap-1 rounded-md border border-line p-2">
              <div className="flex items-center gap-1">
                <Input
                  dense
                  aria-label={`Name of ${m.name}`}
                  defaultValue={m.name}
                  onBlur={(e) => {
                    const input = e.currentTarget;
                    const name = input.value.trim();
                    if (!name) input.value = m.name;
                    else if (name !== m.name) patch(input, m, { name }, m.name, "rename the measurement");
                  }}
                />
                <IconButton
                  icon="eye"
                  size="sm"
                  label={`Fly to ${m.name}`}
                  onClick={() => onFlyTo(m.points[m.points.length - 1] as MPoint)}
                />
                <IconButton icon="trash" size="sm" label={`Delete ${m.name}`} onClick={() => remove(m)} />
              </div>
              <span className="text-xs tabular-nums text-muted">
                {KIND_LABEL[m.kind]} · {main} · ± {formatLength(res.uncertainty_m ?? 0)}
              </span>
              <Input
                dense
                aria-label={`Note for ${m.name}`}
                placeholder="Note"
                defaultValue={m.note ?? ""}
                onBlur={(e) => {
                  const input = e.currentTarget;
                  if (input.value !== (m.note ?? ""))
                    patch(input, m, { note: input.value || null }, m.note ?? "", "save the note");
                }}
              />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
