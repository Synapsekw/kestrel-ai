import { Link, useLocation } from "react-router-dom";
import { useAgentPanel } from "@/agent/panelStore";
import { Button, Icon, IconButton, KeyChord, Tooltip, buttonClass, cx, focusRing } from "@/ui";
import { useRouteActions, type RouteAction } from "./routeActions";
import { routeInfo, topBarTitle } from "./routeModel";
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

/**
 * The top bar (spec 2026-09-26-foundation section 5.1, title per 2026-10-03-sidebar section 5): the page
 * title, the palette field (Ctrl K), the route's context actions, the running pill and the agent button.
 */
export function TopBar({
  projectId,
  onOpenPalette,
}: {
  projectId: string | undefined;
  onOpenPalette: () => void;
}) {
  const { pathname } = useLocation();
  const actions = useRouteActions();
  const agentOpen = useAgentPanel((s) => s.open);
  return (
    <header className="flex h-14 shrink-0 items-center gap-3.5 border-b border-line px-5">
      <p className="min-w-0 truncate text-lg text-ink">{topBarTitle(routeInfo(pathname))}</p>
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
        onClick={() => useAgentPanel.getState().setOpen(true)}
      />
    </header>
  );
}
