import { useMemo, useState } from "react";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { createPointCloudExport, deletePointCloud, patchPointCloud, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Pill, Select } from "@/ui";
import { crsLabel, crsName, formatBytes, formatPoints, heightsLabel } from "./format";
import { rankMaps } from "./link";

const m3 = (v: number) => v.toFixed(3);

export function CloudDetails({
  projectId,
  cloud,
  maps,
  exportJobId,
  onExportStarted,
  onChanged,
  onDeleted,
}: {
  projectId: string;
  cloud: PointCloud;
  maps: GeoMap[];
  /** This cloud's running export; the screen follows it to the end (ExportWatch), not this tab. */
  exportJobId: string | null;
  onExportStarted(jobId: string): void;
  onChanged(c: PointCloud): void;
  onDeleted(): void;
}) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [epsg, setEpsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const exportJob = useJobsStore((st) => (exportJobId ? st.jobs[exportJobId] : undefined));
  const exporting = !!exportJob && isActiveJob(exportJob);
  const ranked = useMemo(() => rankMaps(cloud, maps), [cloud, maps]);
  // The current link stays listed even when its map no longer qualifies, so the select never
  // pretends the cloud is unlinked.
  const staleLink =
    cloud.map_id && !ranked.some((r) => r.map.id === cloud.map_id)
      ? (maps.find((m) => m.id === cloud.map_id)?.name ?? "Linked map")
      : null;
  const b = cloud.bounds_native;

  const patch = (body: Parameters<typeof patchPointCloud>[3]) =>
    void patchPointCloud(api, projectId, cloud.id, body)
      .then((c) => {
        setError(null);
        onChanged(c);
      })
      .catch((e: unknown) => setError(messageOf(e, "could not save")));

  const facts: [string, string][] = [
    ["Points", cloud.point_count != null ? formatPoints(cloud.point_count) : "—"],
    ["File", cloud.source_path],
    ["Size", formatBytes(cloud.source_size)],
    ["Format", cloud.las_version ? `LAS ${cloud.las_version} · format ${cloud.point_format}` : "—"],
    ["Coordinates", [crsLabel(cloud), crsName(cloud.crs_wkt)].filter(Boolean).join(" · ")],
    ["Heights", heightsLabel(cloud)],
    ["Bounds", b ? `${m3(b[0])}, ${m3(b[1])} – ${m3(b[3])}, ${m3(b[4])}` : "—"],
    ["Octree spacing", cloud.octree_spacing_m != null ? `${cloud.octree_spacing_m.toFixed(2)} m` : "—"],
    ["Z p1–p99", cloud.z_stats ? `${cloud.z_stats.p1.toFixed(2)} – ${cloud.z_stats.p99.toFixed(2)} m` : "—"],
  ];

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {facts.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="min-w-0 break-words text-right tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {cloud.bounds_repaired && (
        <p className="text-xs text-muted">
          Header bounds repaired: the file's header box missed some points, so the import fixed its own copy
          (the file itself is unchanged).
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
      <Field label="Captured on" htmlFor="cloud-captured">
        <Input
          // Uncontrolled and saved when left (or on Enter): typing a year passes through 0002, 0020,
          // 0202... which must never be sent. Keyed on the stored date, so a saved or failed value
          // (and a change from elsewhere) resets the field to what the server holds.
          key={cloud.captured_on ?? ""}
          id="cloud-captured"
          type="date"
          defaultValue={cloud.captured_on ?? ""}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={(e) => {
            const input = e.currentTarget;
            const stored = cloud.captured_on ?? "";
            if (input.validity.badInput) {
              input.value = stored; // half a date: neither a date nor "cleared"
              return;
            }
            if (input.value === stored) return;
            const value = input.value || null;
            void patchPointCloud(api, projectId, cloud.id, { captured_on: value })
              .then((c) => {
                setError(null);
                onChanged(c);
              })
              .catch((err: unknown) => {
                input.value = cloud.captured_on ?? "";
                setError(messageOf(err, "could not save"));
              });
          }}
        />
      </Field>
      {!cloud.crs_wkt && (
        <Field
          label="EPSG code"
          htmlFor="cloud-epsg"
          hint="The file has no coordinate system. Assign the one it was surveyed in."
        >
          <div className="flex gap-2">
            <Input
              id="cloud-epsg"
              inputMode="numeric"
              value={epsg}
              onChange={(e) => setEpsg(e.target.value.replace(/\D/g, ""))}
            />
            <Button disabled={!epsg} onClick={() => patch({ assign_epsg: Number(epsg) })}>
              Assign CRS
            </Button>
          </div>
        </Field>
      )}
      <Field
        label="Linked map"
        htmlFor="cloud-link"
        hint={ranked.length ? undefined : "No ready map with coordinates overlaps this cloud."}
      >
        <Select
          id="cloud-link"
          value={cloud.map_id ?? ""}
          disabled={!cloud.crs_wkt}
          onChange={(e) => patch({ map_id: e.target.value || null })}
        >
          <option value="">Not linked</option>
          {staleLink && cloud.map_id && <option value={cloud.map_id}>{staleLink} (current link)</option>}
          {ranked.map((r) => (
            <option key={r.map.id} value={r.map.id}>
              {r.map.name} · {Math.round(r.overlap * 100)} % overlap
              {r.likelySameFlight ? " · likely same flight" : ""}
            </option>
          ))}
        </Select>
      </Field>
      {ranked[0]?.likelySameFlight && cloud.map_id !== ranked[0].map.id && (
        <Pill tone="accent">likely same flight: {ranked[0].map.name}</Pill>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-3">
        <Button
          icon="download"
          loading={exporting}
          disabled={cloud.status !== "ready"}
          onClick={() =>
            void createPointCloudExport(api, projectId, cloud.id, true)
              .then((job) => {
                useJobsStore.getState().upsert(job);
                onExportStarted(job.id);
              })
              .catch((e: unknown) => setError(messageOf(e, "could not start the export")))
          }
        >
          Export LAZ
        </Button>
        <Button variant="danger" icon="trash" onClick={() => setConfirmDelete(true)}>
          Delete
        </Button>
      </div>
      {confirmDelete && (
        <Dialog
          open
          title={`Delete ${cloud.name}?`}
          description="The 3D view copy and the measurements go; the source file is not touched."
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <Button onClick={() => setConfirmDelete(false)}>Keep it</Button>
              <Button
                variant="danger"
                onClick={() =>
                  void deletePointCloud(api, projectId, cloud.id)
                    .then(onDeleted)
                    .catch((e: unknown) => {
                      setConfirmDelete(false);
                      setError(messageOf(e, "could not delete"));
                    })
                }
              >
                Delete
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted">{cloud.source_path}</p>
        </Dialog>
      )}
    </div>
  );
}
