import { useState } from "react";
import { useApi } from "@/api/client";
import { deletePointCloud, type PointCloud } from "@/api/clouds";
import { ApiFailure, messageOf } from "@/api/errors";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, Dialog } from "@/ui";

const plural = (n: number) => `${n} ${n === 1 ? "finding" : "findings"}`;

/**
 * Deleting a cloud (spec C14, controller ruling 12). The server refuses with 409
 * `cloud_has_findings {count}` while findings are pinned on it; the dialog then asks again, naming
 * the count, and only that second, explicit confirm sends `delete_findings=true`. That confirm also
 * deletes the findings server-side, so the findings list must re-read (controller ruling).
 */
export function DeleteCloudDialog({
  projectId,
  cloud,
  open,
  onClose,
  onDeleted,
}: {
  projectId: string;
  cloud: PointCloud;
  open: boolean;
  onClose(): void;
  onDeleted(): void;
}) {
  const api = useApi();
  const [findings, setFindings] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const close = () => {
    setFindings(null);
    setError(null);
    onClose();
  };
  const run = (deleteFindings: boolean) => {
    setBusy(true);
    setError(null);
    void deletePointCloud(api, projectId, cloud.id, { deleteFindings })
      .then(
        () => {
          setFindings(null);
          if (deleteFindings) useChangesStore.getState().bumpFindings();
          onDeleted();
        },
        (e: unknown) => {
          if (!deleteFindings && e instanceof ApiFailure && e.code === "cloud_has_findings") {
            const n = Number(e.details.count);
            setFindings(Number.isFinite(n) ? n : 0);
            return;
          }
          setError(messageOf(e, "could not delete"));
        },
      )
      .finally(() => setBusy(false));
  };

  if (findings !== null)
    return (
      <Dialog
        open
        title={`Delete the cloud and its ${plural(findings)}?`}
        description="Findings are inspection evidence: their photos, comments and history are deleted with them."
        onClose={close}
        footer={
          <>
            <Button onClick={close}>Keep them</Button>
            <Button variant="danger" loading={busy} onClick={() => run(true)}>
              {`Delete cloud and ${plural(findings)}`}
            </Button>
          </>
        }
      >
        {error && <Alert tone="danger">{error}</Alert>}
        <p className="text-sm text-muted">
          {cloud.name} has {plural(findings)} pinned on it. The source file is not touched.
        </p>
      </Dialog>
    );
  return (
    <Dialog
      open
      title={`Delete ${cloud.name}?`}
      description="The 3D view copy and the measurements go; the source file is not touched."
      onClose={close}
      footer={
        <>
          <Button onClick={close}>Keep it</Button>
          <Button variant="danger" loading={busy} onClick={() => run(false)}>
            Delete
          </Button>
        </>
      }
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <p className="text-sm text-muted">{cloud.source_path}</p>
    </Dialog>
  );
}
