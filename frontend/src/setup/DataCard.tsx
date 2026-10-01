import { useEffect, useState } from "react";
import { useBackend } from "@/api/client";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Icon, Input, Progress, cx } from "@/ui";
import type { ProjectTemplate, TemplateSlot } from "./api";
import { useSetupDraft } from "./draftStore";
import { pickFiles, pickFolders, subscribeFolderDrop } from "./folderDrop";
import {
  MAX_DROP_PATHS,
  SAME_FOLDER_NOTE,
  TRUNCATED_TEXT,
  emptyRequired,
  isAbsolutePath,
  sharesFolder,
} from "./model";
import { SetupCard } from "./SetupCard";
import { SlotGrid } from "./SlotGrid";
import { useInspect } from "./useInspect";

export interface DataCardProps {
  templates: readonly ProjectTemplate[];
  /** "Use it" on a suggestion; the page routes it through the replace-or-keep choice. */
  onUseTemplate: (t: ProjectTemplate) => void;
}

/** Card 3 (spec §8 Data): drop or type a folder, follow the sort, then the slots. */
export function DataCard({ templates, onUseTemplate }: DataCardProps) {
  const { mode } = useBackend();
  const desktop = mode === "tauri";
  const inspect = useInspect();
  const { start } = inspect;
  const slots = useSetupDraft((s) => s.slots);
  const buckets = useSetupDraft((s) => s.buckets);
  const templateId = useSetupDraft((s) => s.templateId);
  const truncated = useSetupDraft((s) => s.truncated);
  const suggestedId = useSetupDraft((s) => s.suggestedTemplateId);
  const [over, setOver] = useState(false);
  const [path, setPath] = useState("");
  const [pathError, setPathError] = useState<string | null>(null);
  const [busyDropJob, setBusyDropJob] = useState<string | null>(null);
  const runningJobId = useSetupDraft((s) => s.inspect?.jobId ?? null);
  const canSort = inspect.libraryUnavailable === null;

  useEffect(() => {
    if (!canSort) return;
    return subscribeFolderDrop({
      onOver: setOver,
      onDrop: (paths) => {
        setOver(false);
        // One sort at a time: say so rather than dropping the folder without a word.
        const run = useSetupDraft.getState().inspect;
        if (run) setBusyDropJob(run.jobId);
        else void start(paths);
      },
    });
  }, [canSort, start]);

  async function browse(slot: TemplateSlot | null) {
    try {
      const paths = slot ? await pickFiles(slot) : await pickFolders();
      if (paths.length > 0) await start(paths, slot?.key ?? null);
    } catch (e) {
      pushLog(`picker failed: ${String(e)}`);
      setPathError("The file picker could not open. Type the path, or drop the folder on this page.");
    }
  }

  async function sortTyped() {
    const p = path.trim();
    if (!isAbsolutePath(p)) {
      setPathError("Type a full path, such as E:\\DCIM\\100MEDIA.");
      return;
    }
    setPathError(null);
    await start([p]);
    // Keep the typed path when the sort did not start, so it can be corrected and retried.
    if (useSetupDraft.getState().inspect) setPath("");
  }

  const suggested =
    suggestedId &&
    suggestedId !== templateId &&
    (templateId === null || emptyRequired(slots, buckets).length > 0)
      ? (templates.find((t) => t.id === suggestedId) ?? null)
      : null;
  const job = inspect.job;

  return (
    <SetupCard n={3} title="Data" aside="Copied into the project folder after you create the project">
      {!canSort ? (
        <Alert tone="warn" title="Sorting is unavailable">
          {`Sorting a folder needs the model library, which could not be opened (${inspect.libraryUnavailable}). Create the project now and add data later from its tabs.`}
        </Alert>
      ) : inspect.running ? (
        <div
          role="status"
          aria-label="Sorting files"
          className="flex flex-col gap-2 rounded-control border border-line bg-surface-2 p-3"
        >
          <div className="flex items-center justify-between gap-3 text-sm text-ink">
            <span>{job?.message || "Sorting the dropped files…"}</span>
            <Button size="sm" variant="ghost" onClick={() => void inspect.cancel()}>
              Cancel
            </Button>
          </div>
          <Progress value={job?.progress} running label="Sorting progress" />
          {inspect.overflow !== null && (
            <p className="text-xs text-muted">
              {`Sorting the first ${MAX_DROP_PATHS} of ${inspect.overflow} items. Drop the other ${inspect.overflow - MAX_DROP_PATHS} when this sort finishes.`}
            </p>
          )}
          {inspect.pollError && (
            <Alert
              tone="warn"
              actions={
                <Button size="sm" onClick={inspect.retryPoll}>
                  Retry
                </Button>
              }
            >
              {inspect.pollError}
            </Alert>
          )}
        </div>
      ) : (
        <div
          role="group"
          aria-label="Drop area"
          data-over={over || undefined}
          className={cx(
            "flex flex-col gap-3 rounded-control border border-dashed p-4 transition-colors duration-fast ease-out reduce-motion:transition-none",
            over ? "border-accent bg-accent-soft" : "border-line-strong bg-surface-2",
          )}
        >
          <div className="flex flex-wrap items-center gap-3">
            <span
              aria-hidden="true"
              className="grid h-9 w-9 place-items-center rounded-sm bg-surface text-accent-ink"
            >
              <Icon name="import" size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink">
                {desktop ? "Drop a folder anywhere on this page" : "Sort a folder"}
              </p>
              <p className="text-xs text-muted">
                Files are sorted into the slots below by type and header. Originals are never touched.
              </p>
            </div>
            {desktop && (
              <Button icon="folder" onClick={() => void browse(null)}>
                Browse folders
              </Button>
            )}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void sortTyped();
            }}
          >
            <Input
              aria-label="Folder or file path"
              className="min-w-0 flex-1 font-mono"
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder="E:\DCIM\100MEDIA or \\server\share\delivery"
            />
            <Button type="submit">Sort files</Button>
          </form>
        </div>
      )}
      {pathError && (
        <p role="alert" className="text-xs text-danger">
          {pathError}
        </p>
      )}
      {busyDropJob !== null && busyDropJob === runningJobId && (
        <p role="status" className="text-xs text-muted">
          {"Sorting in progress. Drop the next folder when it finishes."}
        </p>
      )}
      {inspect.error && (
        <Alert tone="danger" onDismiss={inspect.dismissError}>
          {inspect.error}
        </Alert>
      )}
      {truncated && <Alert tone="warn">{TRUNCATED_TEXT}</Alert>}
      {suggested && (
        <Alert
          tone="info"
          actions={
            <Button size="sm" onClick={() => onUseTemplate(suggested)}>
              Use it
            </Button>
          }
        >
          {`These files look like ${suggested.name}.`}
        </Alert>
      )}
      {sharesFolder(buckets) && <p className="text-xs text-muted">{SAME_FOLDER_NOTE}</p>}
      <SlotGrid onBrowse={desktop && canSort && !inspect.running ? (slot) => void browse(slot) : undefined} />
    </SetupCard>
  );
}
