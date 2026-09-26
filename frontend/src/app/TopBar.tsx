import { Link, useLocation } from "react-router-dom";
import { useAgentPanel } from "@/agent/panelStore";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { Button, Icon, IconButton, KeyChord, StatusDot, Tooltip, buttonClass, cx, focusRing } from "@/ui";
import { useRouteActions, type RouteAction } from "./routeActions";
import { SECTION_LABEL, routeInfo } from "./routeModel";
import { RunningPill } from "./RunningPill";

function ActionControl({ action }: { action: RouteAction }) {
  const variant = action.variant ?? "secondary";
  if (action.to && !action.disabled) {
    return (
      <Link to={action.to} className={buttonClass(variant, "sm")}>
        {action.icon && <Icon name={action.icon} size={14} />}
        {action.label}
      </Link>
    );
  }
  const button = (
    <Button size="sm" variant={variant} icon={action.icon} disabled={action.disabled} onClick={action.run}>
      {action.label}
    </Button>
  );
  if (!action.tooltip) return button;
  // A disabled button gets no pointer or focus events, so the wrapper carries the tooltip.
  return (
    <Tooltip label={action.tooltip}>
      <span
        tabIndex={action.disabled ? 0 : undefined}
        className={cx("inline-flex rounded-control", focusRing)}
      >
        {button}
      </span>
    </Tooltip>
  );
}

function Crumbs({
  projectId,
  projectName,
  busy,
}: {
  projectId?: string;
  projectName: string | null;
  busy: boolean;
}) {
  const { pathname } = useLocation();
  const info = routeInfo(pathname);
  const sep = (
    <li aria-hidden="true" className="text-dim">
      /
    </li>
  );
  if (projectId) {
    return (
      <nav aria-label="Breadcrumb" className="min-w-0">
        <ol className="flex min-w-0 items-center gap-2 text-sm text-muted">
          <li>
            <Link to="/projects" className="hover:text-ink">
              Projects
            </Link>
          </li>
          {sep}
          <li className="flex min-w-0 items-center gap-2">
            <StatusDot
              status={busy ? "running" : "idle"}
              live={busy}
              label={busy ? "Jobs running" : "Idle"}
            />
            <Link to={`/p/${projectId}/overview`} className="truncate font-semibold text-ink">
              {projectName ?? "Project"}
            </Link>
          </li>
          {info.page && (
            <>
              {sep}
              <li aria-current="page" className="truncate text-ink">
                {info.page}
              </li>
            </>
          )}
        </ol>
      </nav>
    );
  }
  const section = info.section ? SECTION_LABEL[info.section] : null;
  const sub = info.page && info.page !== section ? info.page : null;
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex min-w-0 items-center gap-2 text-sm text-muted">
        {section && (
          <li aria-current={sub ? undefined : "page"} className={sub ? undefined : "font-semibold text-ink"}>
            {section}
          </li>
        )}
        {sub && (
          <>
            {sep}
            <li aria-current="page" className="text-ink">
              {sub}
            </li>
          </>
        )}
      </ol>
    </nav>
  );
}

/**
 * The top bar (spec 2026-09-26-foundation section 5.1): breadcrumb, the palette field (Ctrl K), the
 * route's context actions, the running pill and the agent button.
 */
export function TopBar({
  projectId,
  projectName,
  onOpenPalette,
}: {
  projectId: string | undefined;
  projectName: string | null;
  onOpenPalette: () => void;
}) {
  const actions = useRouteActions();
  const agentOpen = useAgentPanel((s) => s.open);
  const busy = useJobsStore(
    (s) => !!projectId && Object.values(s.jobs).some((j) => j.project_id === projectId && isActiveJob(j)),
  );
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line px-5">
      <Crumbs projectId={projectId} projectName={projectName} busy={busy} />
      <RunningPill projectId={projectId} />
      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Search and commands"
        aria-keyshortcuts="Control+K"
        className={cx(
          "ml-auto flex h-[34px] w-[300px] min-w-0 shrink items-center gap-2 rounded-control border border-line bg-field px-2.5 text-sm text-dim hover:text-muted",
          focusRing,
        )}
      >
        <Icon name="search" size={14} />
        <span className="min-w-0 flex-1 truncate text-left">Search findings, data, measurements…</span>
        <KeyChord chord="Ctrl+K" className="shrink-0" />
      </button>
      {actions.map((action) => (
        <ActionControl key={action.id} action={action} />
      ))}
      <IconButton
        icon="sparkle"
        label={projectId ? "Project agent" : "Setup agent"}
        aria-controls={projectId ? "project-agent" : "setup-agent"}
        aria-expanded={agentOpen}
        onClick={() => {
          useJobsStore.getState().setPanelOpen(false);
          useAgentPanel.getState().setOpen(true);
        }}
      />
    </header>
  );
}
