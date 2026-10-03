import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useBrandLogoSrc, useBrands, type Brand } from "@/api/brands";
import { ApiFailure, codeOf, messageOf } from "@/api/errors";
import { useReportActions, versionOutline, type ReportConfig, type ReportVersion } from "@/api/reports";
import { pushLog } from "@/app/diagnostics";
import { Alert, Button, Icon, Input, Skeleton, cx, focusRing, toast } from "@/ui";
import { normaliseSections, type RenderFormat } from "./builderModel";
import { versionName, withoutStop } from "./format";
import { coverBrandOf } from "./preview/coverBrand";
import { ReportPreview, type ReportPreviewHandle } from "./ReportPreview";
import { RenderButton } from "./RenderButton";
import { ReportHistory } from "./ReportHistory";
import { ReportSettings } from "./ReportSettings";
import { SaveTemplateDialog } from "./SaveTemplateDialog";
import { SectionList } from "./SectionList";
import { useReportDraft, type SaveState } from "./useReportDraft";
import { useVersionHistory } from "./useVersionHistory";
import { WarningsChip } from "./WarningsChip";

const SAVE_TEXT: Partial<Record<SaveState, string>> = {
  pending: "Saving…",
  saving: "Saving…",
  saved: "Saved",
};

/**
 * Spec §12 ReportBuilder: sections (left, 280 px), preview (centre, scrolls), settings (right, 320 px).
 * The top bar has the title, the warnings chip, Save as template, History and Render. A version picked
 * in History is previewed read-only (R-7.3) until Back to draft or any edit.
 */
export function ReportBuilder({ projectId, reportId }: { projectId: string; reportId: string }) {
  const draft = useReportDraft(projectId, reportId);
  const brandList = useBrands();
  const brandLogo = useBrandLogoSrc();
  const coverOf = (brandId: string | null | undefined) => {
    const b: Brand | undefined = brandList.brands.find((x) => x.id === brandId);
    return b ? coverBrandOf(b, brandLogo(b, "on_dark")) : null;
  };
  const versions = useVersionHistory(projectId, reportId);
  const actions = useReportActions(projectId);
  const previewRef = useRef<ReportPreviewHandle>(null);
  const [viewing, setViewing] = useState<ReportVersion | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [formats, setFormats] = useState<RenderFormat[]>(["pdf"]);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  /** Render stopped because the last change was not saved; the copy follows the save error. */
  const [saveBlocked, setSaveBlocked] = useState(false);
  const centre = useRef<HTMLDivElement>(null);
  /** The version left with Back to draft, so focus can land somewhere sensible afterwards. */
  const leftVersion = useRef<number | null>(null);
  const back = `/p/${projectId}/reports`;

  // Any edit returns the preview to the draft (R-7.3).
  const { edit: draftEdit, setTitle: draftSetTitle } = draft;
  const edit = useCallback(
    (change: (c: ReportConfig) => ReportConfig) => {
      setViewing(null);
      draftEdit(change);
    },
    [draftEdit],
  );
  const setTitle = useCallback(
    (title: string) => {
      setViewing(null);
      draftSetTitle(title);
    },
    [draftSetTitle],
  );

  async function render() {
    setRendering(true);
    setRenderError(null);
    setSaveBlocked(false);
    try {
      if (!(await draft.flush())) {
        setSaveBlocked(true);
        return;
      }
      const { job } = await actions.render(reportId, { formats });
      versions.track(job.id);
      setHistoryOpen(true);
    } catch (e) {
      if (codeOf(e) === "render_running") {
        const running = e instanceof ApiFailure ? e.details.job_id : undefined;
        if (typeof running === "string") versions.track(running);
        else versions.reload();
        setHistoryOpen(true);
        toast("info", "This report is already rendering; its progress is in History.");
      } else {
        pushLog(`render failed to start: ${messageOf(e, String(e))}`);
        setRenderError(`${withoutStop(messageOf(e, "The render did not start"))}. Try Render again.`);
      }
    } finally {
      setRendering(false);
    }
  }

  function backToDraft() {
    leftVersion.current = viewing?.number ?? null;
    setViewing(null);
  }

  // Back to draft unmounts the banner that held focus: put it on the History row's View button when
  // History is open, else on the preview pane.
  useEffect(() => {
    const n = leftVersion.current;
    if (n === null || viewing) return;
    leftVersion.current = null;
    const view = historyOpen ? document.querySelector<HTMLElement>(`[data-view-version="${n}"]`) : null;
    (view ?? centre.current)?.focus();
  }, [viewing, historyOpen]);

  const backLink = (
    <Link
      to={back}
      aria-label="All reports"
      className={cx(
        "grid h-8 w-8 shrink-0 place-items-center rounded-control text-muted hover:bg-hover hover:text-ink",
        focusRing,
      )}
    >
      <Icon name="arrow-left" size={16} />
    </Link>
  );

  if (draft.status === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-6">
        {backLink}
        <Alert tone="danger">{draft.loadError}</Alert>
      </div>
    );
  }
  if (!draft.config) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <Skeleton className="h-40 w-2/3" />
      </div>
    );
  }

  const config = draft.config;
  // While a change is unsaved (or its save failed) the outline's count is stale: say it is counting.
  const unsaved =
    draft.saveState === "pending" || draft.saveState === "saving" || draft.saveState === "error";
  const matchCount = unsaved ? null : (draft.outline?.finding_count ?? null);
  const saveText = SAVE_TEXT[draft.saveState];
  const blockedText =
    saveBlocked && draft.saveState === "error"
      ? draft.saveErrorCode === "invalid_report"
        ? "The report was not rendered because its last change was not saved. Fix the setting named above, then render again."
        : `The report could not be saved: ${withoutStop(draft.saveError ?? "the save failed")}. Try Render again.`
      : null;
  const alertText = renderError ?? blockedText;
  const viewed = viewing && typeof viewing.number === "number" ? { v: viewing, n: viewing.number } : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2.5">
        {backLink}
        <Input
          aria-label="Report title"
          dense
          value={draft.title}
          maxLength={200}
          invalid={!draft.title.trim()}
          onChange={(e) => setTitle(e.target.value)}
          className="w-72"
        />
        {draft.saveState === "error" ? (
          <p role="alert" className="max-w-md truncate text-xs text-danger" title={draft.saveError ?? ""}>
            Not saved: {draft.saveError}
          </p>
        ) : (
          saveText && (
            <span role="status" className="text-xs text-muted">
              {saveText}
            </span>
          )
        )}
        <span className="flex-1" />
        <WarningsChip warnings={draft.outline?.warnings ?? []} />
        <Button size="sm" variant="ghost" icon="plus" onClick={() => setTemplateOpen(true)}>
          Save as template
        </Button>
        <Button
          size="sm"
          variant="secondary"
          icon="list"
          aria-expanded={historyOpen}
          onClick={() => setHistoryOpen((o) => !o)}
        >
          History
        </Button>
        <RenderButton
          formats={formats}
          onFormatsChange={setFormats}
          onRender={() => void render()}
          busy={rendering}
        />
      </header>
      {alertText && (
        <Alert tone="danger" className="mx-4 mt-3">
          {alertText}
        </Alert>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)_320px]">
        <aside aria-label="Report sections" className="min-h-0 overflow-y-auto border-r border-line p-3">
          <SectionList
            sections={config.sections}
            onChange={(sections) => edit((c) => ({ ...c, sections: normaliseSections(sections) }))}
            onShow={(key) => previewRef.current?.scrollToSection(key)}
          />
        </aside>
        <div ref={centre} tabIndex={-1} className="flex min-h-0 flex-col focus:outline-none">
          {viewed ? (
            <>
              <Alert
                tone="info"
                role="status"
                className="mx-4 mt-3 shrink-0"
                actions={
                  <Button size="sm" variant="secondary" icon="arrow-left" onClick={backToDraft}>
                    Back to draft
                  </Button>
                }
              >
                {`Viewing ${versionName(viewed.n)} (read only)`}
              </Alert>
              <ReportPreview
                key={`v${viewed.n}`}
                ref={previewRef}
                projectId={projectId}
                outline={versionOutline(viewed.v)}
                loadBlocks={actions.versionLoader(reportId, viewed.n)}
                pageCount={viewed.v.stats.page_count}
                paper={viewed.v.config.paper.size}
                brand={coverOf(viewed.v.config.brand_id)}
                className="min-h-0 flex-1"
              />
            </>
          ) : (
            <ReportPreview
              key="draft"
              ref={previewRef}
              projectId={projectId}
              outline={draft.outline}
              loadBlocks={actions.blocksLoader(reportId)}
              pageCount={versions.lastPages}
              paper={config.paper.size}
              brand={coverOf(config.brand_id)}
              className="min-h-0 flex-1"
            />
          )}
        </div>
        <aside aria-label="Report settings" className="min-h-0 overflow-y-auto border-l border-line p-4">
          <ReportSettings
            projectId={projectId}
            config={config}
            onEdit={edit}
            matchCount={matchCount}
            brands={brandList.loading ? null : brandList.brands}
          />
        </aside>
      </div>
      <ReportHistory
        projectId={projectId}
        versions={versions}
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        // View v<n> is a toggle (aria-pressed): pressing the shown version again returns to the draft.
        onView={(v) => setViewing((cur) => (cur && cur.number === v.number ? null : v))}
        viewing={viewed?.n ?? null}
        onDeleted={(n) => setViewing((cur) => (cur && cur.number === n ? null : cur))}
      />
      {templateOpen && (
        <SaveTemplateDialog
          open
          onClose={() => setTemplateOpen(false)}
          config={config}
          defaultName={draft.title.trim() || config.cover.title}
        />
      )}
    </div>
  );
}
