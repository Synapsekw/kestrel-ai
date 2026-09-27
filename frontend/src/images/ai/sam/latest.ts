/** One request in flight; while it runs, only the newest submitted value waits (spec §10 flow 2). */
export class LatestOnly<T, R> {
  private inFlight = false;
  private queued: { v: T } | null = null;
  private epoch = 0;

  constructor(
    private readonly send: (v: T) => Promise<R>,
    private readonly onResult: (r: R, v: T) => void,
    private readonly onError: (e: unknown) => void,
  ) {}

  submit(v: T): void {
    if (this.inFlight) {
      this.queued = { v };
      return;
    }
    this.run(v);
  }

  /** Forget the queue and ignore the answer of the request in flight. */
  reset(): void {
    this.queued = null;
    this.epoch += 1;
    this.inFlight = false;
  }

  private run(v: T): void {
    const epoch = this.epoch;
    this.inFlight = true;
    this.send(v).then(
      (r) => this.done(epoch, () => this.onResult(r, v)),
      (e: unknown) => this.done(epoch, () => this.onError(e)),
    );
  }

  private done(epoch: number, report: () => void): void {
    if (epoch !== this.epoch) return;
    this.inFlight = false;
    report();
    const next = this.queued;
    this.queued = null;
    if (next) this.run(next.v);
  }
}
