import { useEffect, useMemo, useRef, useState } from "react";
import type { GeoMap } from "@contract/client";
import { useApi } from "@/api/client";
import { createPointCloudExport, deletePointCloud, patchPointCloud, type PointCloud } from "@/api/clouds";
import { messageOf } from "@/api/errors";
import { revealInExplorer } from "@/api/exports";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Alert, Button, Dialog, Field, Input, Pill, Select, toast } from "@/ui";
import { crsLabel, crsName, formatBytes, formatPoints, heightsLabel } from "./format";
import { rankMaps } from "./link";

const m3 = (v: number) => v.toFixed(3);

export function CloudDetails({
  projectId,
  cloud,
  maps,
  onChanged,
  onDeleted,
}: {
  projectId: string;
  cloud: PointCloud;
  maps: GeoMap[];
  onChanged(c: PointCloud): void;
  onDeleted(): void;
}) {
  const api = useApi();
  const [error, setError] = useState<string | null>(null);
  const [epsg, setEpsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const { job: exportJob } = useTrackedJob(projectId, exportJobId);
  const ranked = useMemo(() => rankMaps(cloud, maps), [cloud, maps]);
  const b = cloud.bounds_native;

  // One toast per finished export; a ref (not state) remembers which job it was already shown for.
  const toasted = useRef<string | null>(null);
  const exporting = !!exportJob && isActiveJob(exportJob);
  useEffect(() => {
    if (!exportJob || isActiveJob(exportJob) || toasted.current === exportJob.id) return;
    toasted.current = exportJob.id;
    if (exportJob.state === "succeeded") {
      const folder = String((exportJob.result as Record<string, unknown> | null)?.folder ?? "exports");
      toast("ok", "LAZ export finished", {
        label: "Show folder",
        onClick: () => void revealInExplorer(api, projectId, folder).catch(() => undefined),
      });
    } else {
      toast("danger", `LAZ export ${exportJob.state}: ${exportJob.error ?? "see the log"}`);
    }
  }, [api, projectId, exportJob]);

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
          id="cloud-captured"
          type="date"
          value={cloud.captured_on ?? ""}
          onChange={(e) => patch({ captured_on: e.target.value || null })}
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
          onClick={() =>
            void createPointCloudExport(api, projectId, cloud.id, true)
              .then((job) => {
                useJobsStore.getState().upsert(job);
                setExportJobId(job.id);
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
