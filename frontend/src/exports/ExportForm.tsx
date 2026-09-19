import { useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { createResultsExport, type ResultsExportFormat } from "@/api/exports";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";

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

const primary = "rounded bg-orange-600 px-3 py-1 text-sm font-medium hover:bg-orange-500 disabled:opacity-50";

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
      className="flex flex-col gap-3 rounded border border-slate-800 bg-slate-800/30 p-4"
    >
      <h2 className="text-lg font-medium">Results</h2>
      {labeledCount !== null && boxCount !== null && imageCount !== null && (
        <p className="text-sm text-slate-300">
          Exports all {plural(imageCount, "image", "images")}:{" "}
          {plural(boxCount, "accepted box", "accepted boxes")} on the {labeledCount} checked{" "}
          {labeledCount === 1 ? "image" : "images"}
          {includeUnreviewed && pendingReviewCount !== null
            ? ` and ${plural(pendingReviewCount, "unreviewed proposal", "unreviewed proposals")}`
            : ""}
          .
        </p>
      )}
      <div className="flex flex-col gap-2">
        {OPTIONS.map((o) => (
          <label key={o.key} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected[o.key]}
              onChange={() => toggle(o.key)}
            />
            <span>
              <span className="block font-medium">{o.label}</span>
              <span className="block text-xs text-slate-400">{o.hint}</span>
            </span>
          </label>
        ))}
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={includeUnreviewed}
          onChange={() => setIncludeUnreviewed((v) => !v)}
        />
        <span>
          Include proposals nobody has reviewed yet (the tables, COCO and the report mark them; YOLO label
          files cannot)
        </span>
      </label>
      {error && (
        <p role="alert" className="text-xs text-red-300">
          {error}
        </p>
      )}
      <div>
        <button type="button" className={primary} onClick={() => void submit()} disabled={busy}>
          Export
        </button>
      </div>
    </section>
  );
}
