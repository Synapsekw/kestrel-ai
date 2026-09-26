import { useState } from "react";
import type { Project } from "@contract/client";
import { useBackend } from "@/api/client";
import { relativeTime } from "@/findings/format";
import { topLevel } from "@/findings/severity";
import { useNow } from "@/jobs/useNow";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import {
  Button,
  GlassPanel,
  Icon,
  MenuButton,
  Pill,
  Progress,
  SeverityPill,
  StatusDot,
  Tooltip,
  useSeverityScale,
} from "@/ui";
import { MigrationDetailsDialog } from "./MigrationDetailsDialog";
import { canOpen, cardState, coverUrl, dataChips } from "./projectCards";

/** The project's newest map preview or photo; a quiet placeholder when it has none or it fails to load. */
function Cover({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="relative h-32 overflow-hidden bg-surface-2">
      {url && !failed ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full place-items-center text-dim">
          <Icon name="images" size={24} />
        </div>
      )}
    </div>
  );
}

/**
 * One project on the Projects grid (F §9.2). A project whose upgrade is waiting, running or failed,
 * or whose folder is gone, is still listed but cannot be opened; nothing here reads the project
 * database, so one broken project never breaks the other cards.
 */
export function ProjectCard({
  project,
  onOpen,
  onRetry,
  onRemove,
  onLocate,
}: {
  project: Project;
  onOpen: (p: Project) => void;
  onRetry: (p: Project) => void;
  onRemove: (p: Project) => void;
  /** Re-points a "Folder not found" entry at the folder's new place; "Locate folder…" hides without it. */
  onLocate?: (p: Project) => void;
}) {
  const { baseUrl, token } = useBackend();
  const nowMs = useNow(60_000);
  const scale = useSeverityScale();
  const state = cardState(project);
  const [details, setDetails] = useState(false);
  const live = useJobsStore((s) =>
    Object.values(s.jobs).some((j) => j.project_id === project.id && isActiveJob(j)),
  );
  const migrationJob = useJobsStore((s) =>
    state.kind === "upgrading" && state.jobId ? s.jobs[state.jobId] : undefined,
  );
  const top = topLevel(scale);
  const s = project.summary;
  const chips = dataChips(s);
  const broken = state.kind === "failed" || state.kind === "missing";

  return (
    <GlassPanel variant="pane" interactive className="flex h-full flex-col overflow-hidden">
      <article aria-label={project.name} className="flex h-full flex-col">
        <Cover url={coverUrl(project, baseUrl, token)} />
        <div className="flex flex-1 flex-col gap-2.5 p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="flex items-center gap-2 text-lg font-semibold">
                <StatusDot status={broken ? "failed" : live ? "running" : "idle"} live={live} />
                <span className="truncate">{project.name}</span>
              </h3>
              <p className="truncate font-mono text-2xs text-muted" title={project.folder}>
                {project.folder}
              </p>
            </div>
            <MenuButton
              label={`More for ${project.name}`}
              iconOnly
              icon="list"
              variant="ghost"
              size="sm"
              items={[
                {
                  id: "remove",
                  label: "Remove from the list",
                  icon: "trash",
                  onSelect: () => onRemove(project),
                },
              ]}
            />
          </div>
          {(s || live) && (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              {s && <span className="font-semibold tabular-nums text-ink">{s.open_findings} open</span>}
              {s && s.open_top_severity > 0 && top && (
                <span className="inline-flex items-center gap-1.5">
                  <SeverityPill level={top.level} size="sm" />
                  <span className="text-xs tabular-nums text-muted">{`${s.open_top_severity} ${top.name}`}</span>
                </span>
              )}
              {live && (
                <Pill size="sm" tone="accent" live>
                  Job running
                </Pill>
              )}
            </div>
          )}
          {chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chips.map((c) => (
                <span
                  key={c}
                  className="rounded-chip bg-surface-2 px-2 py-0.5 font-mono text-2xs tabular-nums text-muted"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
          {state.kind === "upgrading" && (
            <div className="flex flex-col gap-1.5">
              <Pill size="sm" tone="accent" live className="self-start">
                Upgrading…
              </Pill>
              <Progress value={migrationJob?.progress ?? 0} running label={`Upgrading ${project.name}`} />
            </div>
          )}
          {state.kind === "pending" && (
            <Pill size="sm" tone="neutral" className="self-start">
              Waiting to upgrade
            </Pill>
          )}
          {state.kind === "missing" && (
            <div className="flex flex-wrap items-center gap-2">
              <Pill size="sm" tone="danger">
                Folder not found
              </Pill>
              {onLocate && (
                <Button size="sm" onClick={() => onLocate(project)}>
                  Locate folder…
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onRemove(project)}>
                Remove from list
              </Button>
            </div>
          )}
          {state.kind === "failed" && (
            <div className="flex flex-wrap items-center gap-2">
              <Pill size="sm" tone="danger">
                Couldn't upgrade
              </Pill>
              <Button size="sm" onClick={() => onRetry(project)}>
                Retry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDetails(true)}>
                Details
              </Button>
            </div>
          )}
          <div className="mt-auto flex items-center justify-between gap-2 pt-1">
            <span className="text-2xs text-muted">
              {project.last_opened_at
                ? `Opened ${relativeTime(project.last_opened_at, nowMs)}`
                : "Never opened here"}
            </span>
            {state.kind === "missing" ? null : canOpen(project) ? (
              <Button size="sm" variant="primary" onClick={() => onOpen(project)}>
                Open
              </Button>
            ) : (
              <Tooltip label="It opens once the upgrade has finished.">
                <Button size="sm" variant="primary" disabled>
                  Open
                </Button>
              </Tooltip>
            )}
          </div>
        </div>
      </article>
      {details && <MigrationDetailsDialog project={project} onClose={() => setDetails(false)} />}
    </GlassPanel>
  );
}
