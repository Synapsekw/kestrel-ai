import type { CloudViewMeta, CloudViewOut, CloudViewPose, CloudViewRender } from "@contract/client";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { VIEW_MAX_BYTES, type CaptureResult } from "../viewer/capture";
import type { Vec3 } from "../viewer/types";
import type { ViewSubject } from "../workspace/seams";
import type { CaptureEngine } from "./captureEngine";
import { autoFramePoint, autoFrameSphere, boundingSphere, copyPose, retarget } from "./framing";
import { findingMarks, measurementMarks, measurementPoints } from "./marks";
import { getAnchorNormal } from "./normals";
import { subjectKey, type QueueReason } from "./viewStore";

export type SubjectGeometry =
  { kind: "finding"; anchor: Vec3 } | { kind: "cloud_measurement"; measurement: CloudMeasurement };

export type JobOutcome = "saved" | "failed" | "stopped";

export interface QueueDeps {
  engine(): CaptureEngine | null;
  resolve(subject: ViewSubject): Promise<SubjectGeometry>;
  storedView(subject: ViewSubject): CloudViewOut | null;
  render(): Pick<CloudViewRender, "colour_mode" | "point_budget" | "point_size" | "clip_box">;
  upload(subject: ViewSubject, image: Blob, meta: CloudViewMeta, signal: AbortSignal): Promise<CloudViewOut>;
  onView(view: CloudViewOut): void;
  onBusy(key: string, busy: boolean): void;
  /** `stopped`: the engine failed and the queue dropped everything waiting (spec §14). */
  onFail(subject: ViewSubject, err: unknown, stopped: boolean): void;
  log?(line: string): void;
}

/** The engine itself failed: no viewer, no pose, or `capture()` rejected. Stops the queue. */
class EngineFailed extends Error {}
/** The queue was disposed while the job ran. */
class Disposed extends Error {}

function centreOf(geom: SubjectGeometry): Vec3 {
  return geom.kind === "finding" ? geom.anchor : boundingSphere(measurementPoints(geom.measurement)).centre;
}

/** The pose rule of spec §11.3 for one job; `cam` is `CaptureEngine.currentPose()` — V1's
 * uncropped pose cropped to 1.6 by the adapter. */
export function poseFor(
  reason: QueueReason,
  geom: SubjectGeometry,
  cam: CloudViewPose,
  stored: CloudViewOut | null,
): CloudViewPose {
  if (reason === "refresh") return copyPose(cam);
  if (reason === "missing" && stored)
    return stored.stale ? retarget(stored.pose, centreOf(geom)) : copyPose(stored.pose);
  return geom.kind === "finding"
    ? autoFramePoint(cam, geom.anchor)
    : autoFrameSphere(cam, measurementPoints(geom.measurement));
}

/** `anchor_normal` for the meta (Ruling 8). */
export function normalFor(
  subject: ViewSubject,
  reason: QueueReason,
  stored: CloudViewOut | null,
): Vec3 | null {
  if (subject.kind !== "finding") return null;
  const fresh = getAnchorNormal(subject.id);
  if (reason === "create" || reason === "move") return fresh;
  const n = stored && !stored.stale ? stored.anchor_normal : null;
  return fresh ?? (n ? [n[0], n[1], n[2]] : null);
}

interface Job {
  subject: ViewSubject;
  key: string;
  reason: QueueReason;
  quiet: boolean;
  done: ((outcome: JobOutcome) => void)[];
}

/** Report-view captures, one at a time (spec §11.3). Disposing it is "leaving the workspace". */
export class CaptureQueue {
  private readonly deps: QueueDeps;
  private readonly abort = new AbortController();
  private pending: Job[] = [];
  private running: Job | null = null;
  private disposed = false;

  constructor(deps: QueueDeps) {
    this.deps = deps;
  }

  enqueue(subject: ViewSubject, reason: QueueReason, opts: { quiet?: boolean } = {}): Promise<JobOutcome> {
    if (this.disposed) return Promise.resolve("stopped");
    const key = subjectKey(subject);
    const quiet = opts.quiet ?? false;
    return new Promise<JobOutcome>((resolve) => {
      const waiting = this.pending.find((j) => j.key === key);
      if (waiting) {
        waiting.reason = reason;
        waiting.quiet = waiting.quiet && quiet;
        waiting.done.push(resolve);
      } else {
        this.pending.push({ subject, key, reason, quiet, done: [resolve] });
        this.deps.onBusy(key, true);
      }
      void this.pump();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    // The running job's own settle (in `pump`) no longer clears busy once disposed (below), so
    // clear it here instead of leaving it dangling until that capture/upload eventually finishes
    // — otherwise a later queue over the same subject key would have its busy flag wiped by it.
    if (this.running) this.deps.onBusy(this.running.key, false);
    this.drop();
  }

  private drop(): void {
    const dropped = this.pending;
    this.pending = [];
    for (const job of dropped) {
      if (this.disposed || job.key !== this.running?.key) this.deps.onBusy(job.key, false);
      for (const done of job.done) done("stopped");
    }
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    while (!this.disposed && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.running = job;
      let outcome: JobOutcome = "saved";
      try {
        await this.run(job);
      } catch (err) {
        if (this.disposed || err instanceof Disposed) outcome = "stopped";
        else if (err instanceof EngineFailed) {
          outcome = "stopped";
          this.drop();
          this.deps.onFail(job.subject, err, true);
        } else {
          outcome = "failed";
          if (!job.quiet) this.deps.onFail(job.subject, err, false);
        }
        this.deps.log?.(
          `report view ${job.key}: ${outcome} (${err instanceof Error ? err.message : String(err)})`,
        );
      }
      this.running = null;
      // Once disposed, busy was already cleared for this job in `dispose()` — don't touch it
      // again, since by the time this settles the key may belong to a different queue.
      if (!this.disposed && !this.pending.some((j) => j.key === job.key)) this.deps.onBusy(job.key, false);
      for (const done of job.done) done(outcome);
    }
  }

  private live(): void {
    if (this.disposed) throw new Disposed("left the workspace");
  }

  private async run(job: Job): Promise<void> {
    const t0 = performance.now();
    const geom = await this.deps.resolve(job.subject);
    this.live();
    const engine = this.deps.engine();
    const cam = engine?.currentPose() ?? null;
    if (!engine || !cam) throw new EngineFailed("the 3D view is not ready");
    const stored = this.deps.storedView(job.subject);
    const pose = poseFor(job.reason, geom, cam, stored);
    const marks = geom.kind === "finding" ? findingMarks(geom.anchor) : measurementMarks(geom.measurement);
    let shot: CaptureResult;
    try {
      shot = await engine.capture(pose, marks);
    } catch (err) {
      throw new EngineFailed(err instanceof Error ? err.message : String(err));
    }
    this.live();
    if (shot.blob.size > VIEW_MAX_BYTES)
      throw new Error(`the report view is over 6 MiB (${shot.blob.size} bytes)`);
    const meta: CloudViewMeta = {
      pose,
      render: { ...this.deps.render(), edl: shot.edl, complete: shot.complete },
      anchor_normal: normalFor(job.subject, job.reason, stored),
    };
    const view = await this.deps.upload(job.subject, shot.blob, meta, this.abort.signal);
    this.live();
    this.deps.onView(view);
    this.deps.log?.(`report view ${job.key}: saved in ${Math.round(performance.now() - t0)} ms`);
  }
}
