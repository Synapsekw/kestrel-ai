import { useCallback, useEffect, useRef, useState } from "react";
import type { ClassDef, MapRun } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import {
  acceptRunAbove,
  nextUnreviewed,
  reviewMapDetections,
  reviewProgressText,
  type MapDetection,
  type ReviewAction,
} from "@/api/review";
import { pushLog } from "@/app/diagnostics";
import { isTypingTarget } from "@/editor/hotkeys";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { Button, Field, Input, Kbd, Pill, Progress, Select, cx, toast, type PillTone } from "@/ui";

export interface MapReviewPanelProps {
  projectId: string;
  run: MapRun;
  classes: ClassDef[];
  /** The detection under review; the screen frames and highlights it on the map. */
  current: MapDetection | null;
  onCurrent: (d: MapDetection | null) => void;
  /** The "Draw missed object" tool: while on, a box dragged on the map is added to the run. */
  drawing: boolean;
  onDrawing: (on: boolean) => void;
  drawClassId: string;
  onDrawClass: (id: string) => void;
  /** A review write landed: the run's counts and the map's boxes need a refresh. */
  onChanged: () => void;
}

const STATE: Record<MapDetection["review_state"], { label: string; tone: PillTone }> = {
  unreviewed: { label: "Not reviewed", tone: "neutral" },
  accepted: { label: "Accepted", tone: "ok" },
  edited: { label: "Class changed", tone: "ok" },
  rejected: { label: "Rejected", tone: "danger" },
};

const DEFAULT_ACCEPT_ABOVE = "0.80";

function fail(action: string, err: unknown) {
  const message = messageOf(err, `could not ${action}`);
  pushLog(`${action} failed: ${message}`);
  toast("danger", message);
}

/**
 * Map review (spec 2026-09-23 section 8): one detection at a time in reading order, decided with
 * A accept, R reject, 1–9 another class, N skip. Every decision moves on to the next unreviewed
 * detection; the run's counts change on the server in the same transaction.
 */
export function MapReviewPanel(p: MapReviewPanelProps) {
  const api = useApi();
  const { projectId, onCurrent, onChanged, current } = p;
  const runId = p.run.id;
  const [remaining, setRemaining] = useState<number | null>(null);
  const [acceptAbove, setAcceptAbove] = useState(DEFAULT_ACCEPT_ABOVE);
  const [accepting, setAccepting] = useState(false);
  const busy = useRef(false);

  const walk = useCallback(
    async (afterId: string | null) => {
      let next = await nextUnreviewed(api, projectId, runId, afterId);
      // Past the last one in reading order but some were skipped: start again from the top.
      if (!next.detection && next.remaining > 0 && afterId)
        next = await nextUnreviewed(api, projectId, runId, null);
      setRemaining(next.remaining);
      onCurrent(next.detection);
    },
    [api, projectId, runId, onCurrent],
  );

  useEffect(() => {
    let cancelled = false;
    void nextUnreviewed(api, projectId, runId, null)
      .then((next) => {
        if (cancelled) return;
        setRemaining(next.remaining);
        onCurrent(next.detection);
      })
      .catch((err: unknown) => {
        if (!cancelled) fail("load the next detection", err);
      });
    return () => {
      cancelled = true;
    };
  }, [api, projectId, runId, onCurrent]);

  const run = useCallback((label: string, op: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    void op()
      .catch((err: unknown) => fail(label, err))
      .finally(() => {
        busy.current = false;
      });
  }, []);

  const decide = useCallback(
    (action: ReviewAction, classId?: string) => {
      const d = current;
      if (!d) return;
      run("review the detection", async () => {
        await reviewMapDetections(api, projectId, runId, [d.id], action, classId);
        onChanged();
        await walk(d.id);
      });
    },
    [api, projectId, runId, current, onChanged, walk, run],
  );

  const skip = useCallback(() => {
    run("load the next detection", () => walk(current?.id ?? null));
  }, [run, walk, current]);

  useOnJobsFinished("accept_above", () => {
    setAccepting(false);
    onChanged();
    run("load the next detection", () => walk(null));
  });

  const classes = p.classes;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        skip();
        return;
      }
      if (!current) return;
      if (key === "a") decide("accept");
      else if (key === "r") decide("reject");
      else {
        const cls = /^[1-9]$/.test(e.key) ? classes.find((c) => c.hotkey === e.key) : undefined;
        if (!cls) return;
        decide("reclass", cls.id);
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [decide, skip, classes, current]);

  const total = p.run.detection_count;
  const reviewed = remaining === null ? null : Math.max(0, total - remaining);
  const threshold = Number(acceptAbove);
  const thresholdValid = acceptAbove.trim() !== "" && threshold >= 0 && threshold <= 1;
  const currentClass = current ? classes.find((c) => c.id === current.class_id) : undefined;

  return (
    <section className="flex flex-col gap-5" aria-label="Review">
      <div className="flex flex-col gap-2">
        <Progress value={reviewed === null || total === 0 ? 0 : reviewed / total} label="Reviewed" />
        <p className="text-xs tabular-nums text-muted">
          {reviewed === null ? "Counting what is left…" : reviewProgressText(reviewed, total)}
        </p>
      </div>

      {current ? (
        <div data-testid="review-current" data-id={current.id} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: currentClass?.colour }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
              {currentClass?.name ?? "Unknown class"}
            </span>
            <span className="text-sm tabular-nums text-muted">{Math.round(current.confidence * 100)}%</span>
            <Pill size="sm" tone={STATE[current.review_state].tone}>
              {STATE[current.review_state].label}
            </Pill>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Button size="sm" variant="primary" onClick={() => decide("accept")}>
              Accept <Kbd className="ml-0.5">A</Kbd>
            </Button>
            <Button size="sm" onClick={() => decide("reject")}>
              Reject <Kbd className="ml-0.5">R</Kbd>
            </Button>
            <Button size="sm" variant="ghost" onClick={skip}>
              Next <Kbd className="ml-0.5">N</Kbd>
            </Button>
          </div>
          <div className="flex flex-col gap-1">
            <p className="text-xs text-muted">Wrong class? Pick the right one.</p>
            <ul className="flex flex-col gap-0.5" aria-label="Change class">
              {classes.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => decide("reclass", c.id)}
                    aria-pressed={c.id === current.class_id}
                    className={cx(
                      "flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm",
                      c.id === current.class_id ? "bg-accent-soft text-accent-ink" : "hover:bg-hover",
                    )}
                  >
                    <span
                      className="h-2.5 w-2.5 rounded-sm"
                      style={{ background: c.colour }}
                      aria-hidden="true"
                    />
                    <span className="flex-1 truncate">{c.name}</span>
                    {c.hotkey && /^[1-9]$/.test(c.hotkey) && <Kbd>{c.hotkey}</Kbd>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        remaining === 0 && <p className="text-sm text-ok">Every detection in this run is reviewed.</p>
      )}

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Button
          size="sm"
          icon="plus"
          variant={p.drawing ? "primary" : "secondary"}
          aria-pressed={p.drawing}
          onClick={() => p.onDrawing(!p.drawing)}
        >
          Draw missed object
        </Button>
        {p.drawing && (
          <Field
            label="Draws as"
            htmlFor="review-draw-class"
            hint="Drag a box on the map. It counts as verified."
          >
            <Select
              id="review-draw-class"
              dense
              value={p.drawClassId}
              onChange={(e) => p.onDrawClass(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <Field
          label="Minimum confidence"
          htmlFor="review-accept-above"
          hint="Accepts every detection not yet reviewed at or above this confidence."
          error={thresholdValid ? undefined : "Enter a number from 0 to 1."}
        >
          <Input
            id="review-accept-above"
            dense
            type="number"
            min={0}
            max={1}
            step={0.05}
            value={acceptAbove}
            invalid={!thresholdValid}
            onChange={(e) => setAcceptAbove(e.target.value)}
          />
        </Field>
        <Button
          size="sm"
          loading={accepting}
          disabled={!thresholdValid || remaining === 0}
          onClick={() => {
            setAccepting(true);
            void acceptRunAbove(api, projectId, runId, threshold)
              .then(() => toast("info", `Accepting detections at or above ${Math.round(threshold * 100)}%`))
              .catch((err: unknown) => {
                setAccepting(false);
                fail("accept detections", err);
              });
          }}
        >
          Accept all at or above
        </Button>
      </div>
    </section>
  );
}
