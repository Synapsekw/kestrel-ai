import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useApi } from "@/api/client";
import type { PointCloud } from "@/api/clouds";
import { useTrackedJob } from "@/jobs/useTrackedJob";
import { Button, EmptyState, GlassPanel, Progress } from "@/ui";
import { defaultCloud, importAgain } from "./cloudActions";
import { DeleteCloudDialog } from "./DeleteCloudDialog";

/** A centred glass card over the empty viewport (spec §6 non-ready states). */
function CentreCard({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 grid place-items-center p-6">
      <GlassPanel
        variant="float"
        radius="panel"
        data-testid={testId}
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 p-5 animate-pop reduce-motion:animate-none"
      >
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        {children}
      </GlassPanel>
    </div>
  );
}

/** An empty project (S1's copy): the only state on the page layout (plan Ruling 2). */
export function NoClouds({ onImport, children }: { onImport(): void; children?: ReactNode }) {
  return (
    <div className="flex h-full flex-col p-6">
      {children}
      <h1 className="text-xl font-semibold">Point clouds</h1>
      <EmptyState
        className="m-auto"
        icon="cloud"
        title="Import a LAS or LAZ point cloud"
        action={
          <Button variant="primary" icon="import" onClick={onImport}>
            Import
          </Button>
        }
      >
        See a drone survey in 3D, measure points, distances and plumbness, pin findings on the structure, and
        hand a LAZ to a client.
      </EmptyState>
    </div>
  );
}

export function ImportingCloud({ projectId, cloud }: { projectId: string; cloud: PointCloud }) {
  const { job } = useTrackedJob(projectId, cloud.job_id ?? null);
  return (
    <CentreCard testId="cloud-importing" title="Building the 3D view copy…">
      <p className="text-sm text-muted">{cloud.name} opens here when its import finishes.</p>
      <Progress thin value={job?.progress ?? 0} running label={job?.message || "importing"} />
    </CentreCard>
  );
}

export function FailedCloud({
  projectId,
  cloud,
  onChanged,
}: {
  projectId: string;
  cloud: PointCloud;
  onChanged(): void;
}) {
  const api = useApi();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  return (
    <CentreCard testId="cloud-failed" title={`${cloud.name} could not be imported`}>
      <p className="text-sm text-muted">{cloud.error ?? "The job log says why."}</p>
      <div className="flex gap-2">
        <Button icon="refresh" onClick={() => importAgain(api, projectId, cloud, navigate, onChanged)}>
          Import again
        </Button>
        <Button variant="danger" icon="trash" onClick={() => setConfirm(true)}>
          Delete
        </Button>
      </div>
      <DeleteCloudDialog
        open={confirm}
        projectId={projectId}
        cloud={cloud}
        onClose={() => setConfirm(false)}
        onDeleted={() => {
          setConfirm(false);
          onChanged();
          navigate(`/p/${projectId}/clouds`);
        }}
      />
    </CentreCard>
  );
}

export function MissingCloud({ projectId, clouds }: { projectId: string; clouds: readonly PointCloud[] }) {
  const navigate = useNavigate();
  const first = defaultCloud(clouds);
  return (
    <div className="absolute inset-0 grid place-items-center p-6">
      <EmptyState
        icon="cloud"
        title="This point cloud is not in the project"
        action={
          <Button variant="primary" onClick={() => navigate(`/p/${projectId}/clouds/${first.id}`)}>
            {`Open ${first.name}`}
          </Button>
        }
      >
        It may have been deleted. The project has {clouds.length} point{" "}
        {clouds.length === 1 ? "cloud" : "clouds"}.
      </EmptyState>
    </div>
  );
}
