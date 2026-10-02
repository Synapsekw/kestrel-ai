import { useState } from "react";
import type { PointCloud } from "@/api/clouds";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { Alert, Button, Icon, cx, focusRing, toast } from "@/ui";
import { measurementsCsv } from "../measureCsv";
import { MeasurementDetails } from "./MeasurementDetails";
import { rowText } from "./measureView";
import { FULL_TEXT, type CloudMeasurements } from "./useCloudMeasurements";

const EMPTY_TEXT =
  "No measurements yet. Point P, Distance L, Height Z, Verticality U, Area Q, Cross-section E.";

function Row({
  m,
  selected,
  onSelect,
  onRetry,
}: {
  m: CloudMeasurement;
  selected: boolean;
  onSelect: () => void;
  onRetry: () => Promise<unknown>;
}) {
  const t = rowText(m);
  const [retrying, setRetrying] = useState(false);
  const handleRetry = () => {
    if (retrying) return;
    setRetrying(true);
    // A synchronous throw or a rejection still unlocks the button, never as an unhandled rejection:
    // the caller reports its own failure (a toast), as in ProfilePanel.
    Promise.resolve()
      .then(onRetry)
      .catch(() => {})
      .finally(() => setRetrying(false));
  };
  return (
    <li className="flex flex-col gap-1">
      <button
        type="button"
        aria-pressed={selected}
        onClick={onSelect}
        className={cx(
          "grid grid-cols-[1fr_auto] gap-x-2 gap-y-0.5 rounded-control border px-2.5 py-2 text-left",
          selected ? "border-accent bg-accent-soft" : "border-transparent hover:bg-hover",
          focusRing,
        )}
      >
        <span className="truncate text-sm font-semibold text-ink">{m.name}</span>
        <span className="flex items-center gap-1 font-mono text-xs tabular-nums text-ink">
          {m.status === "computing" && <Icon name="spinner" size={12} className="text-muted" />}
          {t.primary}
        </span>
        <span
          className={cx("col-span-2 truncate text-xs", m.status === "failed" ? "text-danger" : "text-muted")}
        >
          {t.subtitle}
        </span>
      </button>
      {m.kind === "profile" && m.status === "failed" && (
        <Button
          size="sm"
          variant="secondary"
          icon="refresh"
          className="self-start"
          disabled={retrying}
          onClick={handleRetry}
        >
          Retry
        </Button>
      )}
    </li>
  );
}

interface MeasurementsTopicProps {
  projectId: string;
  cloud: PointCloud;
  list: CloudMeasurements;
}

/** The Measurements list (spec §8.5): this cloud's saved rows and "Copy all as CSV". */
export function MeasurementsList({
  list,
  onSelect,
  onRetry,
}: MeasurementsTopicProps & {
  onSelect: (m: CloudMeasurement) => void;
  onRetry: (m: CloudMeasurement) => Promise<unknown>;
}) {
  const n = list.items.length;
  const copy = () =>
    void navigator.clipboard
      .writeText(measurementsCsv(list.items))
      .then(() => toast("ok", `Copied ${n} measurement${n === 1 ? "" : "s"}`))
      .catch(() => toast("danger", "could not copy to the clipboard"));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className={cx("text-xs", list.full ? "text-warn" : "text-muted")}>
          {list.full ? FULL_TEXT : `${n} saved`}
        </span>
        <Button size="sm" variant="ghost" disabled={n === 0} onClick={copy}>
          Copy all as CSV
        </Button>
      </div>
      {list.error && (
        <Alert
          tone="danger"
          actions={
            <Button size="sm" icon="refresh" onClick={list.reload}>
              Retry
            </Button>
          }
        >
          {list.error}
        </Alert>
      )}
      {list.loaded && n === 0 && <p className="text-sm text-muted">{EMPTY_TEXT}</p>}
      <ul aria-label="Saved measurements" className="flex flex-col gap-1">
        {list.items.map((m) => (
          <Row
            key={m.id}
            m={m}
            selected={m.id === list.selectedId}
            onSelect={() => onSelect(m)}
            onRetry={() => onRetry(m)}
          />
        ))}
      </ul>
    </div>
  );
}

/** The selected measurement's details (spec §8.5), or nothing without a selection. */
export function MeasurementDetail({ projectId, cloud, list }: MeasurementsTopicProps) {
  if (!list.selected) return null;
  return (
    <MeasurementDetails
      key={list.selected.id}
      projectId={projectId}
      cloud={cloud}
      m={list.selected}
      list={list}
    />
  );
}
