interface ProgressRecord {
  kind?: string;
  epoch?: number;
  epochs?: number;
  metrics?: Record<string, number>;
  loss?: Record<string, number>;
  eta_s?: number;
}

const pct = (v: number | undefined): string | null =>
  typeof v === "number" ? `${(v * 100).toFixed(1)}%` : null;

/** The trainer writes JSON progress records into the job log; show them as sentences, keep the rest. */
export function readableLogLine(line: string): string {
  if (!line.startsWith("{")) return line;
  let rec: ProgressRecord;
  try {
    rec = JSON.parse(line) as ProgressRecord;
  } catch {
    return line;
  }
  if (rec.kind === "start" && typeof rec.epochs === "number") return `training started: ${rec.epochs} epochs`;
  if (rec.kind !== "epoch" || typeof rec.epoch !== "number") return line;
  const m = rec.metrics ?? {};
  const parts = [
    pct(m["metrics/mAP50(B)"]) && `mAP50 ${pct(m["metrics/mAP50(B)"])}`,
    pct(m["metrics/precision(B)"]) && `precision ${pct(m["metrics/precision(B)"])}`,
    pct(m["metrics/recall(B)"]) && `recall ${pct(m["metrics/recall(B)"])}`,
  ].filter(Boolean);
  const loss = Object.entries(rec.loss ?? {})
    .map(([k, v]) => `${k.replace(/_loss$/, "")} ${v.toFixed(3)}`)
    .join(" ");
  if (loss) parts.push(`loss ${loss}`);
  if (typeof rec.eta_s === "number") parts.push(`about ${Math.round(rec.eta_s)} s left`);
  return `epoch ${rec.epoch}/${rec.epochs}: ${parts.join(", ")}`;
}
