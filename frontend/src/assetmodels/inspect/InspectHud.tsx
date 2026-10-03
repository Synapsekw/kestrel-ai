import type { Finding } from "@/api/findings";
import { formatFindingNumber } from "@/findings/format";
import { GlassPanel, SeverityPill } from "@/ui";
import { captureText } from "./nav";

/** Spec §9 HUD: height, side and capture time, with the finding and the sighting position. */
export function InspectHud({
  finding,
  typeName,
  zone,
  captureTime,
  index,
  count,
}: {
  finding: Finding;
  typeName: string | undefined;
  zone: string | null;
  captureTime: string | null | undefined;
  index: number;
  count: number;
}) {
  const facts: [string, string | null][] = [
    ["Height", finding.height_m == null ? null : `${finding.height_m.toFixed(1)} m`],
    ["Side", finding.side ?? null],
    ["Zone", zone],
    ["Taken", captureText(captureTime)],
  ];
  return (
    <GlassPanel
      variant="float"
      radius="control"
      data-testid="inspect-hud"
      className="pointer-events-none absolute bottom-3.5 left-3.5 z-10 flex max-w-[calc(100%-28px)] flex-col gap-1 px-3 py-2"
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-ink">{formatFindingNumber(finding.number)}</span>
        {typeName && <span className="text-sm text-ink">{typeName}</span>}
        <SeverityPill level={finding.severity} size="sm" />
        <span className="text-xs text-muted">
          {count > 0 ? `Sighting ${index + 1} of ${count}` : "No sightings"}
        </span>
      </div>
      <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
        {facts.map(([k, v]) => (
          <div key={k} className="flex gap-1.5">
            <dt className="text-muted">{k}</dt>
            <dd className="tabular-nums text-ink">{v ?? (k === "Taken" ? "Unknown" : "Not placed")}</dd>
          </div>
        ))}
      </dl>
    </GlassPanel>
  );
}
