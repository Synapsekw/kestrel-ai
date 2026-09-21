import { useState, type MouseEvent, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { Icon, IconButton, Tooltip, cx, focusRing, transition, type IconName } from "@/ui";
import { Brand } from "./Brand";
import { stepStates, type Step, type StepState } from "./pipeline";
import { useProgress } from "./useProjectProgress";

const entryClass = (isActive: boolean, locked = false, compact = false) =>
  cx(
    "group flex w-full shrink-0 items-center rounded-md font-medium",
    compact ? "h-12 flex-col justify-center gap-1 px-1 text-[11px]" : "h-9 gap-2.5 px-2.5 text-sm",
    transition,
    focusRing,
    locked
      ? "text-muted"
      : isActive
        ? "bg-accent-soft text-accent-ink"
        : "text-muted hover:bg-hover hover:text-ink",
  );

/** The 18px step indicator: tick when done, ring with the number otherwise. */
function StepMark({ state, n }: { state: StepState; n: number }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border text-[10px] font-semibold tabular-nums",
        transition,
        state === "done" && "border-ok bg-ok text-ground",
        state === "current" && "border-accent bg-accent-soft text-accent-ink",
        state === "upcoming" && "border-line-strong text-muted",
        state === "locked" && "border-line text-dim",
      )}
    >
      {state === "done" ? <Icon name="check" size={10} className="[stroke-width:3]" /> : n}
    </span>
  );
}

function StepEntry({ step, n, compact }: { step: Step; n: number; compact: boolean }) {
  const locked = step.state === "locked";
  // The editor has its own route; it is where the Label step happens, so Label stays lit there.
  const { pathname } = useLocation();
  const inEditor = step.id === "label" && pathname.includes("/edit/");
  const active = inEditor || pathname === step.path || pathname.startsWith(`${step.path}/`);
  const link = (
    <Link
      to={step.path}
      aria-disabled={locked || undefined}
      aria-current={active ? "page" : undefined}
      onClick={(e: MouseEvent) => {
        if (locked) e.preventDefault();
      }}
      className={entryClass(active && !locked, locked, compact)}
    >
      {compact ? (
        <span className="relative">
          <Icon
            name={step.id === "export" ? "download" : step.id}
            size={18}
            className={step.state === "current" ? "text-accent" : undefined}
          />
          {step.state === "done" && (
            <span className="absolute -right-2 -top-1 rounded-full bg-side text-ok">
              <Icon name="check" size={9} />
            </span>
          )}
        </span>
      ) : (
        <StepMark state={step.state} n={n} />
      )}
      <span className="truncate">{step.label}</span>
      {step.count && (
        <span
          className={cx(
            compact ? "sr-only" : "ml-auto text-xs tabular-nums",
            step.state === "current" && step.id === "review" ? "font-semibold text-accent-ink" : "text-muted",
          )}
        >
          {step.count}
        </span>
      )}
    </Link>
  );
  return locked && step.lockedReason ? (
    <Tooltip label={step.lockedReason} side="right" className="w-full shrink-0">
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function PlainEntry({
  to,
  icon,
  children,
  end,
  compact = false,
  shortLabel,
}: {
  to: string;
  icon: IconName;
  children: ReactNode;
  end?: boolean;
  compact?: boolean;
  shortLabel?: string;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      aria-label={typeof children === "string" ? children : undefined}
      className={({ isActive }) => entryClass(isActive, false, compact)}
    >
      <Icon name={icon} size={compact ? 18 : 16} />
      <span className="max-w-full truncate">{compact && shortLabel ? shortLabel : children}</span>
    </NavLink>
  );
}

interface Props {
  projectId: string | undefined;
  projectName: string | null;
}

/** The left rail: Projects, then the open project's pipeline, then Models and the settings. */
export function Sidebar({ projectId, projectName }: Props) {
  const [expanded, setExpanded] = useState(false);
  const compact = !!projectId && !expanded;
  const progress = useProgress(projectId);
  const steps = projectId && progress ? stepStates(projectId, progress) : null;
  return (
    <nav
      aria-label="Main navigation"
      className={cx(
        "flex shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-side py-3",
        compact ? "w-[82px] px-2" : "w-56 px-3",
      )}
    >
      <div className={cx("mb-1 flex items-center", compact ? "flex-col gap-2" : "justify-between")}>
        <Brand compact={compact} />
        {projectId && (
          <IconButton
            size="sm"
            icon={compact ? "chevron-right" : "arrow-left"}
            label={compact ? "Expand navigation" : "Collapse navigation"}
            aria-expanded={!compact}
            onClick={() => setExpanded((value) => !value)}
          />
        )}
      </div>
      <PlainEntry to="/" icon="folder" end compact={compact}>
        Projects
      </PlainEntry>
      {projectId ? (
        <>
          <p
            className={
              compact
                ? "sr-only"
                : "mt-4 truncate px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted"
            }
          >
            {projectName ?? "Project"}
          </p>
          <PlainEntry to={`/p/${projectId}`} icon="home" end compact={compact}>
            Home
          </PlainEntry>
          {steps
            ? steps.map((step, i) => <StepEntry key={step.id} step={step} n={i + 1} compact={compact} />)
            : stepStates(projectId, {
                images: 0,
                labeled: 0,
                pendingReview: 0,
                datasets: 0,
                models: 0,
                trainedModels: 0,
                queryRuns: 0,
              }).map((step, i) => <StepEntry key={step.id} step={step} n={i + 1} compact={compact} />)}
          <div className="my-2 border-t border-line" />
          <PlainEntry to={`/p/${projectId}/models`} icon="models" compact={compact}>
            Models
          </PlainEntry>
          <PlainEntry to={`/p/${projectId}/settings`} icon="settings" compact={compact} shortLabel="Project">
            Project settings
          </PlainEntry>
        </>
      ) : (
        <p className="mt-4 px-2.5 text-xs leading-relaxed text-muted">
          Open or create a project to use these.
        </p>
      )}
      <div className="mt-auto border-t border-line pt-2">
        <PlainEntry to="/settings" icon="settings" compact={compact} shortLabel="Settings">
          App settings
        </PlainEntry>
      </div>
    </nav>
  );
}
