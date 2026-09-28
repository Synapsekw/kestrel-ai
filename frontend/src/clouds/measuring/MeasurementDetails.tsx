import { useApi } from "@/api/client";
import type { PointCloud } from "@/api/clouds";
import {
  deleteCloudMeasurement,
  updateCloudMeasurement,
  type CloudMeasurement,
} from "@/api/cloudMeasurements";
import type { components } from "@contract/client";
import { messageOf } from "@/api/errors";
import { Alert, Button, Disclosure, Input, Textarea, toast } from "@/ui";
import { NON_COPLANAR_NOTE, isNonCoplanar } from "../measure";
import { useWorkspaceSeams } from "../workspace/seams";
import { AttachFinding } from "./AttachFinding";
import { PROFILE_FAILED, resultRows } from "./measureView";
import type { CloudMeasurements } from "./useCloudMeasurements";

type Update = components["schemas"]["CloudMeasurementUpdate"];

/** Spec §8.5 details: coordinates, every result with its uncertainty, rename and note, attach,
 * the report view, delete. */
export function MeasurementDetails({
  projectId,
  cloud,
  m,
  list,
}: {
  projectId: string;
  cloud: PointCloud;
  m: CloudMeasurement;
  list: CloudMeasurements;
}) {
  const api = useApi();
  const { ReportViewCard } = useWorkspaceSeams();
  const save = (body: Update, what: string, undo?: () => void) =>
    void updateCloudMeasurement(api, projectId, cloud.id, m.id, body)
      .then(list.upsert)
      .catch((e: unknown) => {
        undo?.();
        toast("danger", messageOf(e, `could not ${what}`));
      });
  const remove = () =>
    void deleteCloudMeasurement(api, projectId, cloud.id, m.id)
      .then(() => {
        list.remove(m.id);
        list.select(null);
      })
      .catch((e: unknown) => toast("danger", messageOf(e, "could not delete the measurement")));
  const warn =
    m.kind === "area" && m.results.plane_rms_m != null && isNonCoplanar(m.results) ? NON_COPLANAR_NOTE : null;

  return (
    <section aria-label={`Details of ${m.name}`} className="flex flex-col gap-3 border-t border-line pt-3">
      <Input
        dense
        aria-label="Name"
        defaultValue={m.name}
        onBlur={(e) => {
          const input = e.currentTarget;
          const name = input.value.trim();
          if (!name) input.value = m.name;
          else if (name !== m.name) save({ name }, "rename the measurement", () => (input.value = m.name));
        }}
      />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {resultRows(m).map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right font-mono text-xs tabular-nums text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      {warn && <Alert tone="warn">{warn}</Alert>}
      {m.status === "failed" && <Alert tone="danger">{m.error ?? PROFILE_FAILED}</Alert>}
      <Disclosure label="Vertices" summary={`${m.points.length}`}>
        <ol className="flex max-h-40 flex-col gap-0.5 overflow-y-auto font-mono text-xs tabular-nums text-ink">
          {m.points.map((p, i) => (
            <li key={i}>
              E {p.x.toFixed(3)} N {p.y.toFixed(3)} Z {p.z.toFixed(3)}
              {p.group === 0 || p.group === 1 ? ` · ring ${p.group === 0 ? "A" : "B"}` : ""}
            </li>
          ))}
        </ol>
      </Disclosure>
      <Textarea
        aria-label="Note"
        placeholder="Note"
        rows={2}
        defaultValue={m.note ?? ""}
        onBlur={(e) => {
          const input = e.currentTarget;
          if (input.value !== (m.note ?? ""))
            save({ note: input.value || null }, "save the note", () => (input.value = m.note ?? ""));
        }}
      />
      <AttachFinding
        projectId={projectId}
        cloudId={cloud.id}
        value={m.finding_id}
        onChange={(finding_id) => save({ finding_id }, "attach the measurement")}
      />
      {ReportViewCard && <ReportViewCard subject={{ kind: "cloud_measurement", id: m.id }} />}
      <Button variant="danger" size="sm" icon="trash" className="self-start" onClick={remove}>
        Delete
      </Button>
    </section>
  );
}
