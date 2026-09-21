import { Link } from "react-router-dom";
import { Icon } from "@/ui";
import { nextStep } from "./nextStep";
import { stepStates } from "./pipeline";
import { useProgress } from "./useProjectProgress";

/** Six short bars, one per pipeline step: green done, orange current, grey otherwise. */
export function StepTicks({ projectId }: { projectId: string }) {
  const progress = useProgress(projectId);
  if (!progress) return null;
  const steps = stepStates(projectId, progress);
  return (
    <span className="flex items-center gap-1" aria-hidden="true">
      {steps.map((s) => (
        <span
          key={s.id}
          title={s.label}
          className={`h-1.5 w-6 rounded-full ${
            s.state === "done" ? "bg-ok" : s.state === "current" ? "bg-accent" : "bg-line-strong/60"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * The banner under the header on project screens: "Next: ..." with one line of why, and the step
 * ticks. Silent until the shell has loaded the project's counts, and when nothing is pending.
 */
export function NextStepBar({ projectId }: { projectId: string }) {
  const progress = useProgress(projectId);
  const step = progress ? nextStep(projectId, progress) : null;
  if (!step) return null;
  return (
    <div
      key={step.text}
      data-testid="next-step"
      className="flex items-center gap-4 border-b border-line bg-ground px-4 py-2 text-[13px] text-accent-ink lg:px-6"
    >
      <Icon name="arrow-right" size={15} className="shrink-0" />
      <p className="min-w-0 flex-1 truncate">
        <span className="text-accent-ink/70">Next: </span>
        <Link
          to={step.to}
          className="font-semibold underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded-sm"
        >
          {step.text}
        </Link>
        <span className="ml-2 text-muted">{step.detail}</span>
      </p>
      <StepTicks projectId={projectId} />
    </div>
  );
}
