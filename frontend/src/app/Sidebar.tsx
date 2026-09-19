import type { MouseEvent, ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { Icon, Tooltip, cx, focusRing, transition, type IconName } from "@/ui";
import { Brand } from "./Brand";
import { stepStates, type Step, type StepState } from "./pipeline";
import { useProgress } from "./useProjectProgress";

const entryClass = (isActive: boolean, locked = false) =>
  cx(
    "group flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm font-medium",
    transition,
    focusRing,
    locked
      ? "text-dim"
      : isActive
        ? "bg-panel text-ink shadow-sm"
        : "text-ink/75 hover:bg-hover hover:text-ink",
  );

/** The 18px step indicator: tick when done, ring with the number otherwise. */
function StepMark({ state, n }: { state: StepState; n: number }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full border text-[10px] font-semibold tabular-nums",
        transition,
        state === "done" && "border-ok bg-ok text-white",
        state === "current" && "border-accent bg-accent-soft text-accent-ink",
        state === "upcoming" && "border-line-strong text-muted",
        state === "locked" && "border-line text-dim",
      )}
    >
      {state === "done" ? <Icon name="check" size={10} className="[stroke-width:3]" /> : n}
    </span>
  );
}

function StepEntry({ step, n }: { step: Step; n: number }) {
  const locked = step.state === "locked";
  const link = (
    <NavLink
      to={step.path}
      aria-disabled={locked || undefined}
      onClick={(e: MouseEvent) => {
        if (locked) e.preventDefault();
      }}
      className={({ isActive }) => entryClass(isActive && !locked, locked)}
    >
      <StepMark state={step.state} n={n} />
      <span className="truncate">{step.label}</span>
      {step.count && (
        <span
          className={cx(
            "ml-auto text-xs tabular-nums",
            step.state === "current" && step.id === "review" ? "font-semibold text-accent-ink" : "text-muted",
          )}
        >
          {step.count}
        </span>
      )}
    </NavLink>
  );
  return locked && step.lockedReason ? (
    <Tooltip label={step.lockedReason} side="right" className="w-full">
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
}: {
  to: string;
  icon: IconName;
  children: ReactNode;
  end?: boolean;
}) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => entryClass(isActive)}>
      <Icon name={icon} size={16} className="text-muted group-[.bg-panel]:text-ink" />
      <span className="truncate">{children}</span>
    </NavLink>
  );
}

interface Props {
  projectId: string | undefined;
  projectName: string | null;
}

/** The left rail: Projects, then the open project's pipeline, then Models and the settings. */
export function Sidebar({ projectId, projectName }: Props) {
  const progress = useProgress(projectId);
  const steps = projectId && progress ? stepStates(projectId, progress) : null;
  return (
    <nav className="flex w-56 shrink-0 flex-col gap-0.5 border-r border-line bg-side px-3 py-3.5">
      <Brand className="mb-3 px-1.5" />
      <PlainEntry to="/" icon="folder" end>
        Projects
      </PlainEntry>
      {projectId ? (
        <>
          <p className="mt-4 truncate px-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
            {projectName ?? "Project"}
          </p>
          <PlainEntry to={`/p/${projectId}`} icon="home" end>
            Home
          </PlainEntry>
          {steps
            ? steps.map((step, i) => <StepEntry key={step.id} step={step} n={i + 1} />)
            : stepStates(projectId, {
                images: 0,
                labeled: 0,
                pendingReview: 0,
                datasets: 0,
                models: 0,
                trainedModels: 0,
                queryRuns: 0,
              }).map((step, i) => (
                <span key={step.id} className="flex h-9 items-center gap-2.5 px-2.5 text-sm text-dim">
                  <StepMark state="upcoming" n={i + 1} />
                  {step.label}
                </span>
              ))}
          <div className="my-2 border-t border-line" />
          <PlainEntry to={`/p/${projectId}/models`} icon="models">
            Models
          </PlainEntry>
          <PlainEntry to={`/p/${projectId}/settings`} icon="settings">
            Project settings
          </PlainEntry>
        </>
      ) : (
        <p className="mt-4 px-2.5 text-xs leading-relaxed text-muted">
          Open or create a project to use these.
        </p>
      )}
      <div className="mt-auto border-t border-line pt-2">
        <PlainEntry to="/settings" icon="settings">
          App settings
        </PlainEntry>
      </div>
    </nav>
  );
}
