import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import {
  deleteReport,
  duplicateReport,
  useReports,
  useReportTemplates,
  type ReportListItem,
} from "@/api/reports";
import {
  Alert,
  Button,
  EmptyState,
  GlassPanel,
  Icon,
  MenuButton,
  SkeletonRows,
  cx,
  focusRing,
  toast,
} from "@/ui";
import { lastVersionLine, pagesLabel } from "./format";
import { NewReportDialog } from "./NewReportDialog";

/** Spec §12 ReportList: glass cards, New report, duplicate and archive. Honours `?new=<templateId>` (ruling 7). */
export function ReportList({ projectId }: { projectId: string }) {
  const api = useApi();
  const list = useReports(projectId);
  const templates = useReportTemplates();
  const [params, setParams] = useSearchParams();
  const requested = params.get("new");
  const [dialog, setDialog] = useState<{ template: string | null } | null>(null);

  // The R8 hand-off: open once per link, then drop `new` from the address so a reload does not reopen it.
  if (requested !== null && dialog === null) setDialog({ template: requested });
  useEffect(() => {
    if (requested === null) return;
    const next = new URLSearchParams(params);
    next.delete("new");
    setParams(next, { replace: true });
  }, [requested, params, setParams]);

  const names = useMemo(() => new Map(templates.items.map((t) => [t.id, t.name])), [templates.items]);
  const templateOf = (id: string | null | undefined) =>
    id ? (names.get(id) ?? "Custom template") : "No template";

  async function duplicate(r: ReportListItem) {
    try {
      const copy = await duplicateReport(api, projectId, r.id);
      toast("ok", `Duplicated as “${copy.title}”`);
      list.reload();
    } catch (e) {
      toast("danger", messageOf(e, "could not duplicate the report"));
    }
  }

  async function archive(r: ReportListItem) {
    try {
      await deleteReport(api, projectId, r.id);
      toast("ok", r.last_version ? `Archived “${r.title}”` : `Deleted “${r.title}”`);
      list.reload();
    } catch (e) {
      toast("danger", messageOf(e, "could not remove the report"));
    }
  }

  const empty = !list.loading && !list.error && list.items.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {!empty && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted">Each report keeps every rendered version.</p>
          <Button variant="primary" icon="plus" onClick={() => setDialog({ template: null })}>
            New report
          </Button>
        </div>
      )}
      {list.loading ? (
        <SkeletonRows rows={3} columns={3} />
      ) : list.error && list.items.length === 0 ? (
        <Alert tone="danger">{list.error}</Alert>
      ) : empty ? (
        <EmptyState
          icon="report"
          title="No reports yet"
          action={
            <Button variant="primary" icon="plus" onClick={() => setDialog({ template: null })}>
              New report
            </Button>
          }
        >
          Pick a template, adjust the sections and filters while the preview updates, and render a PDF.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-3">
          {list.items.map((r) => (
            <li key={r.id}>
              <GlassPanel as="section" interactive aria-label={r.title} className="flex h-full gap-3 p-4">
                <span
                  aria-hidden
                  className="grid h-14 w-10 shrink-0 place-items-center rounded-sm bg-grad-primary text-accent-fg"
                >
                  <Icon name="report" size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/p/${projectId}/reports/${r.id}`}
                    className={cx("block truncate text-base font-medium text-ink hover:underline", focusRing)}
                  >
                    {r.title}
                  </Link>
                  <p className="truncate text-xs text-muted">{templateOf(r.template_id)}</p>
                  <p className="mt-2 flex flex-wrap gap-x-2 text-xs">
                    <span className={r.last_version?.state === "failed" ? "text-danger" : "text-ink"}>
                      {lastVersionLine(r.last_version)}
                    </span>
                    {r.last_version?.pages != null && (
                      <span className="text-muted">{pagesLabel(r.last_version.pages)}</span>
                    )}
                  </p>
                </div>
                <MenuButton
                  iconOnly
                  icon="more"
                  size="sm"
                  label={`Actions for ${r.title}`}
                  items={[
                    { id: "duplicate", label: "Duplicate", icon: "plus", onSelect: () => void duplicate(r) },
                    {
                      id: "archive",
                      label: r.last_version ? "Archive" : "Delete",
                      icon: "trash",
                      danger: !r.last_version,
                      onSelect: () => void archive(r),
                    },
                  ]}
                />
              </GlassPanel>
            </li>
          ))}
        </ul>
      )}
      {list.error && list.items.length > 0 && <Alert tone="danger">{list.error}</Alert>}
      {list.hasMore && (
        <Button variant="ghost" onClick={list.loadMore} className="self-center">
          Load more reports
        </Button>
      )}
      {dialog && (
        <NewReportDialog
          projectId={projectId}
          open
          onClose={() => setDialog(null)}
          initialTemplateId={dialog.template}
        />
      )}
    </div>
  );
}
