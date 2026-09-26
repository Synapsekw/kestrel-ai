import { useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createResultsExport, type ResultsExportFormat } from "@/api/exports";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { Alert, Button, Checkbox } from "@/ui";

interface Props {
  projectId: string;
  /** From project stats; null while it is still loading. */
  labeledCount: number | null;
  boxCount: number | null;
  imageCount: number | null;
  pendingReviewCount: number | null;
  onStarted?: (job: Job) => void;
}

interface FormatOption {
  key: ResultsExportFormat;
  label: string;
  hint: string;
}

const OPTIONS: FormatOption[] = [
  {
    key: "csv",
    label: "Tables for Excel (CSV)",
    hint: "Every detection, plus totals per flight and per image — opens directly in Excel.",
  },
  {
    key: "yolo",
    label: "Labels in YOLO format",
    hint: "One .txt file per image with normalised box coordinates, for Ultralytics or any YOLO-compatible tool.",
  },
  {
    key: "coco",
    label: "Labels in COCO format",
    hint: "One labels_coco.json with images, categories and annotations, for tools that read the COCO format.",
  },
  {
    key: "html",
    label: "Report (HTML, printable)",
    hint: "One page with a thumbnail of every labeled image and the counts per class — open it in a browser or print it.",
  },
];

const DEFAULT_SELECTED: Record<ResultsExportFormat, boolean> = {
  csv: true,
  yolo: false,
  coco: false,
  html: true,
};

/** "1 image" / "3 images" — the app's usual inline pluralisation (see e.g. data/importNotice.ts). */
function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ExportForm({
  projectId,
  labeledCount,
  boxCount,
  imageCount,
  pendingReviewCount,
  onStarted,
}: Props) {
  const api = useApi();
  const [selected, setSelected] = useState(DEFAULT_SELECTED);
  const [includeUnreviewed, setIncludeUnreviewed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(key: ResultsExportFormat) {
    setSelected((s) => ({ ...s, [key]: !s[key] }));
    setError(null);
  }

  async function submit() {
    const formats = OPTIONS.map((o) => o.key).filter((k) => selected[k]);
    if (formats.length === 0) {
      setError("Choose at least one format.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const job = await createResultsExport(api, projectId, {
        formats,
        include_unreviewed: includeUnreviewed,
      });
      useJobsStore.getState().upsert(job);
      onStarted?.(job);
    } catch (e) {
      pushLog(`create results export failed: ${messageOf(e, String(e))}`);
      setError(messageOf(e, "could not start the export"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-label="Results"
      className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5"
    >
      <h2 className="text-base font-semibold">Results</h2>
      {labeledCount !== null && boxCount !== null && imageCount !== null && (
        <p className="text-sm text-muted">
          {imageCount === 1 ? "Exports 1 image" : `Exports all ${plural(imageCount, "image", "images")}`}:{" "}
          {plural(boxCount, "accepted box", "accepted boxes")} on the {labeledCount} checked{" "}
          {labeledCount === 1 ? "image" : "images"}
          {includeUnreviewed && pendingReviewCount !== null
            ? ` and ${plural(pendingReviewCount, "unreviewed suggestion", "unreviewed suggestions")}`
            : ""}
          .
        </p>
      )}
      <div className="flex flex-col gap-2">
        {OPTIONS.map((o) => (
          <Checkbox
            key={o.key}
            checked={selected[o.key]}
            onChange={() => toggle(o.key)}
            className="items-start [&>span:first-of-type]:mt-0.5"
            label={
              <span>
                <span className="block font-medium">{o.label}</span>
                <span className="block text-xs leading-relaxed text-muted">{o.hint}</span>
              </span>
            }
          />
        ))}
      </div>
      <Checkbox
        checked={includeUnreviewed}
        onChange={() => setIncludeUnreviewed((v) => !v)}
        className="items-start [&>span:first-of-type]:mt-0.5"
        label={
          <span className="leading-relaxed">
            Include suggestions nobody has reviewed yet. The tables, COCO and the report mark them; YOLO label
            files cannot.
          </span>
        }
      />
      {error && <Alert tone="danger">{error}</Alert>}
      <Button
        variant="primary"
        icon="download"
        loading={busy}
        onClick={() => void submit()}
        className="self-start"
      >
        Export
      </Button>
    </section>
  );
}
