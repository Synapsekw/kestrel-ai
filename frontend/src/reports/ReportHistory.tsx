import { useEffect, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import { deleteVersion, openProjectFile, setVersionIssued, type ReportVersion } from "@/api/reports";
import { formatBytes } from "@/clouds/format";
import { RevealButton } from "@/exports/RevealButton";
import { JobCard } from "@/jobs/JobCard";
import { Alert, Button, Dialog, IconButton, Pill, Skeleton, type PillTone } from "@/ui";
import {
  pagesLabel,
  shortDate,
  versionError,
  versionName,
  versionPages,
  versionParts,
  withoutStop,
} from "./format";
import type { VersionHistory } from "./useVersionHistory";

const STATE_TONE: Record<ReportVersion["state"], PillTone> = {
  rendering: "accent",
  ready: "ok",
  failed: "danger",
};
const STATE_LABEL: Record<ReportVersion["state"], string> = {
  rendering: "Rendering",
  ready: "Ready",
  failed: "Failed",
};

export interface ReportHistoryProps {
  projectId: string;
  versions: VersionHistory;
  open: boolean;
  onClose: () => void;
  /** R-7.3 (recon 10 overrides plan Ruling 6): shows a `View v<n>` toggle on each numbered, ready row. */
  onView?: (v: ReportVersion) => void;
  /** The version number currently shown read-only in the preview (T9); marks its `View v<n>` pressed. */
  viewing?: number | null;
  /** Called with a version's number once it is deleted (T9 leaves its read-only view). */
  onDeleted?: (n: number) => void;
}

/**
 * Spec §12 ReportHistory: a drawer (Ruling 1: a non-modal aside) listing versions with state, pages,
 * parts and files. Actions: Open PDF, Show in folder, Mark as issued / Unissue, Delete version (never
 * issued only), and (R-7.3, when `onView` is given) View v<n> to preview that version read-only. A
 * running render shows its JobCard.
 */
export function ReportHistory({
  projectId,
  versions,
  open,
  onClose,
  onView,
  viewing,
  onDeleted,
}: ReportHistoryProps) {
  const api = useApi();
  const panel = useRef<HTMLElement>(null);
  const [confirm, setConfirm] = useState<ReportVersion | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  async function remove() {
    if (!confirm || typeof confirm.number !== "number") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteVersion(api, projectId, versions.reportId, confirm.number);
      onDeleted?.(confirm.number);
      setConfirm(null);
      versions.reload();
    } catch (e) {
      setDeleteError(
        codeOf(e) === "issued_version"
          ? `${withoutStop(messageOf(e, "This version was issued, so it is kept"))}. Unissue it first to delete it.`
          : messageOf(e, "could not delete the version"),
      );
    } finally {
      setDeleting(false);
    }
  }

  const empty = !versions.loading && !versions.error && versions.items.length === 0 && !versions.running;
  return (
    <aside
      ref={panel}
      role="dialog"
      aria-modal="false"
      aria-label="History"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-y-0 right-0 z-30 flex w-[26rem] max-w-full flex-col border-l border-line bg-glass-solid text-ink shadow-elev-2 animate-slide-in focus:outline-none reduce-motion:animate-none"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-4">
        <h2 className="min-w-0 flex-1 text-base font-semibold">History</h2>
        <IconButton icon="x" label="Close history" onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
        {versions.running && <JobCard projectId={projectId} job={versions.running} />}
        {versions.loading ? (
          <Skeleton className="h-24 w-full" />
        ) : versions.error ? (
          <Alert tone="danger">{versions.error}</Alert>
        ) : empty ? (
          <p className="text-sm text-muted">No versions yet. Render the report to make v1.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {versions.items.map((v) => (
              <VersionRow
                key={v.id}
                projectId={projectId}
                reportId={versions.reportId}
                version={v}
                onChanged={versions.reload}
                onDelete={(x) => {
                  setDeleteError(null);
                  setConfirm(x);
                }}
                onView={onView}
                viewing={viewing}
              />
            ))}
          </ul>
        )}
        {versions.hasMore && (
          <Button size="sm" variant="ghost" onClick={versions.loadMore} className="self-start">
            Show older versions
          </Button>
        )}
      </div>
      <Dialog
        open={confirm !== null}
        title={`Delete ${versionName(confirm?.number)}?`}
        description="Its files are removed from the project folder. Issued versions are never deleted."
        onClose={() => setConfirm(null)}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Keep version
            </Button>
            <Button variant="danger" loading={deleting} onClick={() => void remove()}>
              Delete version
            </Button>
          </>
        }
      >
        {deleteError ? (
          <Alert tone="danger">{deleteError}</Alert>
        ) : (
          <p className="text-sm text-muted">The next render still gets the next number.</p>
        )}
      </Dialog>
    </aside>
  );
}

function VersionRow({
  projectId,
  reportId,
  version: v,
  onChanged,
  onDelete,
  onView,
  viewing,
}: {
  projectId: string;
  reportId: string;
  version: ReportVersion;
  onChanged: () => void;
  onDelete: (v: ReportVersion) => void;
  onView?: (v: ReportVersion) => void;
  viewing?: number | null;
}) {
  const api = useApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const n = v.number;
  const pdfs = v.files.filter((f) => f.kind === "pdf");
  const parts = versionParts(v);
  const failure = versionError(v);
  const ready = typeof n === "number" && v.state === "ready";

  async function run(id: string, fn: () => Promise<unknown>) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(messageOf(e, "the action failed; try again"));
    } finally {
      setBusy(null);
    }
  }

  const issue = (issued: boolean) =>
    typeof n === "number" &&
    run(issued ? "issue" : "unissue", async () => {
      await setVersionIssued(api, projectId, reportId, n, issued);
      onChanged();
    });
  const openPdf = (name: string) =>
    run(`open:${name}`, () => openProjectFile(api, projectId, `${v.folder}/${name}`));

  const name =
    typeof n === "number" ? versionName(n) : v.state === "rendering" ? "Rendering…" : "Render failed";
  const meta = [pagesLabel(versionPages(v)), parts > 1 ? `${parts} parts` : ""].filter(Boolean).join(" · ");

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm text-ink">{name}</span>
        <Pill size="sm" tone={STATE_TONE[v.state]}>
          {STATE_LABEL[v.state]}
        </Pill>
        {v.issued_at && (
          <Pill size="sm" tone="accent">
            Issued {shortDate(v.issued_at)}
          </Pill>
        )}
        <span className="ml-auto text-2xs text-muted">{shortDate(v.created_at)}</span>
      </div>
      {v.state === "ready" && meta && <p className="text-xs text-muted">{meta}</p>}
      {failure && <p className="text-xs text-danger">{failure}</p>}
      {v.files.length > 0 && (
        <ul className="flex flex-col gap-0.5 text-xs">
          {v.files.map((f) => (
            <li key={f.name} className="flex gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-ink">{f.name}</span>
              <span className="shrink-0 text-muted">{formatBytes(f.bytes)}</span>
            </li>
          ))}
        </ul>
      )}
      {ready && (
        <div className="flex flex-wrap items-center gap-2">
          {pdfs.map((f, i) => (
            <Button
              key={f.name}
              size="sm"
              icon="external"
              loading={busy === `open:${f.name}`}
              onClick={() => void openPdf(f.name)}
            >
              {pdfs.length === 1 ? "Open PDF" : `Open part ${i + 1}`}
            </Button>
          ))}
          {v.folder && <RevealButton projectId={projectId} path={v.folder} />}
          {onView && (
            <Button
              size="sm"
              variant={viewing === n ? "secondary" : "ghost"}
              aria-pressed={viewing === n}
              data-view-version={n}
              onClick={() => onView(v)}
            >
              {`View ${versionName(n)}`}
            </Button>
          )}
          {v.issued_at ? (
            <Button size="sm" variant="ghost" loading={busy === "unissue"} onClick={() => void issue(false)}>
              Unissue
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                variant="secondary"
                loading={busy === "issue"}
                onClick={() => void issue(true)}
              >
                Mark as issued
              </Button>
              <Button size="sm" variant="danger" icon="trash" onClick={() => onDelete(v)}>
                Delete version
              </Button>
            </>
          )}
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </li>
  );
}
