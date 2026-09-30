import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ApiClient, components, paths } from "@contract/client";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { useJobsStore } from "@/store/jobs";
import { ApiContext, useApi } from "./client";
import { messageOf, unwrap } from "./errors";
import type { Page } from "./paging";

type S = components["schemas"];
const P = "/api/v1/projects/{projectId}" as const;
const R = "/api/v1/projects/{projectId}/reports/{reportId}" as const;

type Json<T> = T extends { content: { "application/json": infer B } } ? B : never;
type BodyOf<Op> = Op extends { requestBody?: infer RB } ? Json<NonNullable<RB>> : never;

export type Report = S["Report"];
export type ReportListItem = S["ReportListItem"];
export type ReportPage = S["ReportPage"];
export type ReportConfig = S["ReportConfig"];
export type SectionKey = S["SectionKey"];
export type ReportOutline = S["ReportOutline"];
export type OutlineSection = S["OutlineSection"];
export type ReportWarning = S["ReportWarning"];
export type Block = S["Block"];
export type BlockKind = Block["kind"];
export type BlockOf<K extends BlockKind> = Extract<Block, { kind: K }>;
export type BlockPage = S["BlockPage"];
export type SnapshotRef = S["SnapshotRef"];
export type SnapshotSpec = S["SnapshotSpec"];
export type ReportVersion = S["ReportVersion"];
export type ReportFile = S["ReportFile"];
export type ReportTemplate = S["ReportTemplate"];
export type ReportAsset = S["ReportAsset"];
export type RenderRequest = S["RenderRequest"];
export type JobRef = S["JobRef"];
/** A page of a version's frozen document, paged across sections (Ruling R-3). */
export type ReportDocumentPage = S["ReportDocumentPage"];

export type ReportCreate = BodyOf<paths["/api/v1/projects/{projectId}/reports"]["post"]>;
export type ReportPatch = BodyOf<paths["/api/v1/projects/{projectId}/reports/{reportId}"]["patch"]>;
/** Merged contract name is `ReportVersionPatch` (Ruling R-1). */
export type VersionPatch = S["ReportVersionPatch"];
/** Merged contract name is `ReportTemplateCreate` (Ruling R-1). */
export type TemplateCreate = S["ReportTemplateCreate"];
/** Merged contract name is `ReportTemplatePatch` (Ruling R-1). */
export type TemplatePatch = S["ReportTemplatePatch"];
/** Merged contract name is `ReportVersionPage` (Ruling R-1). */
export type VersionList = S["ReportVersionPage"];
/** Merged contract name is `ReportTemplatePage` (Ruling R-1). */
export type TemplateList = S["ReportTemplatePage"];

/** One page of a section's blocks; the preview asks for the next page with the previous `next_cursor`. */
export type LoadBlocks = (key: SectionKey, cursor: string | null) => Promise<BlockPage>;

/** List pages (reports, versions, templates): spec §15, every list pages. */
export const REPORTS_PAGE = 50;
/** `GET …/sections/{sectionKey}/blocks?limit≤50` (spec §14). */
export const BLOCKS_PAGE = 50;

const paged = (cursor?: string) => ({ limit: REPORTS_PAGE, ...(cursor ? { cursor } : {}) });
const blockQuery = (cursor: string | null) => ({ limit: BLOCKS_PAGE, ...(cursor ? { cursor } : {}) });

export function listReports(
  api: ApiClient,
  projectId: string,
  cursor?: string,
  opts?: { includeArchived?: boolean },
): Promise<ReportPage> {
  const query: { limit: number; cursor?: string; include_archived?: boolean } = { limit: REPORTS_PAGE };
  if (cursor) query.cursor = cursor;
  if (opts?.includeArchived !== undefined) query.include_archived = opts.includeArchived;
  return unwrap(api.GET(`${P}/reports`, { params: { path: { projectId }, query } }));
}

export function createReport(api: ApiClient, projectId: string, body: ReportCreate): Promise<Report> {
  return unwrap(api.POST(`${P}/reports`, { params: { path: { projectId } }, body }));
}

export function getReport(api: ApiClient, projectId: string, reportId: string): Promise<Report> {
  return unwrap(api.GET(R, { params: { path: { projectId, reportId } } }));
}

export function patchReport(
  api: ApiClient,
  projectId: string,
  reportId: string,
  body: ReportPatch,
): Promise<Report> {
  return unwrap(api.PATCH(R, { params: { path: { projectId, reportId } }, body }));
}

export async function deleteReport(api: ApiClient, projectId: string, reportId: string): Promise<void> {
  await unwrap(api.DELETE(R, { params: { path: { projectId, reportId } } }));
}

export function duplicateReport(api: ApiClient, projectId: string, reportId: string): Promise<Report> {
  return unwrap(api.POST(`${R}/duplicate`, { params: { path: { projectId, reportId } } }));
}

export function getOutline(api: ApiClient, projectId: string, reportId: string): Promise<ReportOutline> {
  return unwrap(api.GET(`${R}/outline`, { params: { path: { projectId, reportId } } }));
}

export function listSectionBlocks(
  api: ApiClient,
  projectId: string,
  reportId: string,
  key: SectionKey,
  cursor: string | null,
): Promise<BlockPage> {
  return unwrap(
    api.GET(`${R}/sections/{sectionKey}/blocks`, {
      params: { path: { projectId, reportId, sectionKey: key }, query: blockQuery(cursor) },
    }),
  );
}

export function startRender(
  api: ApiClient,
  projectId: string,
  reportId: string,
  body: RenderRequest,
): Promise<JobRef> {
  return unwrap(api.POST(`${R}/renders`, { params: { path: { projectId, reportId } }, body }));
}

export function listVersions(
  api: ApiClient,
  projectId: string,
  reportId: string,
  cursor?: string,
): Promise<VersionList> {
  return unwrap(
    api.GET(`${R}/versions`, { params: { path: { projectId, reportId }, query: paged(cursor) } }),
  );
}

export function getVersion(
  api: ApiClient,
  projectId: string,
  reportId: string,
  n: number,
): Promise<ReportVersion> {
  return unwrap(
    api.GET(`${R}/versions/{versionNumber}`, { params: { path: { projectId, reportId, versionNumber: n } } }),
  );
}

export function setVersionIssued(
  api: ApiClient,
  projectId: string,
  reportId: string,
  n: number,
  issued: boolean,
): Promise<ReportVersion> {
  const body: VersionPatch = { issued };
  return unwrap(
    api.PATCH(`${R}/versions/{versionNumber}`, {
      params: { path: { projectId, reportId, versionNumber: n } },
      body,
    }),
  );
}

export async function deleteVersion(
  api: ApiClient,
  projectId: string,
  reportId: string,
  n: number,
): Promise<void> {
  await unwrap(
    api.DELETE(`${R}/versions/{versionNumber}`, {
      params: { path: { projectId, reportId, versionNumber: n } },
    }),
  );
}

/**
 * One page of a frozen version's document, paged across sections (no `section` query in the merged
 * contract — Ruling R-3). `versionBlocksLoader` adapts this into a per-section `LoadBlocks`.
 */
export function getVersionDocumentPage(
  api: ApiClient,
  projectId: string,
  reportId: string,
  n: number,
  cursor: string | null,
): Promise<ReportDocumentPage> {
  return unwrap(
    api.GET(`${R}/versions/{versionNumber}/document`, {
      params: { path: { projectId, reportId, versionNumber: n }, query: blockQuery(cursor) },
    }),
  );
}

/** Opens a file inside the project with its default application (`os.startfile`, spec §14). */
export async function openProjectFile(api: ApiClient, projectId: string, path: string): Promise<void> {
  await unwrap(api.POST(`${P}/open`, { params: { path: { projectId } }, body: { path } }));
}

/** `path` is a local image chosen in the Tauri dialog; refused above 20 MB (R1). */
export function importReportAsset(api: ApiClient, projectId: string, path: string): Promise<ReportAsset> {
  return unwrap(api.POST(`${P}/report-assets`, { params: { path: { projectId } }, body: { path } }));
}

export function listTemplates(api: ApiClient, cursor?: string): Promise<TemplateList> {
  return unwrap(api.GET("/api/v1/report-templates", { params: { query: paged(cursor) } }));
}

export function createTemplate(api: ApiClient, body: TemplateCreate): Promise<ReportTemplate> {
  return unwrap(api.POST("/api/v1/report-templates", { body }));
}

export function getTemplate(api: ApiClient, templateId: string): Promise<ReportTemplate> {
  return unwrap(api.GET("/api/v1/report-templates/{templateId}", { params: { path: { templateId } } }));
}

export function patchTemplate(
  api: ApiClient,
  templateId: string,
  body: TemplatePatch,
): Promise<ReportTemplate> {
  return unwrap(
    api.PATCH("/api/v1/report-templates/{templateId}", { params: { path: { templateId } }, body }),
  );
}

export async function deleteTemplate(api: ApiClient, templateId: string): Promise<void> {
  await unwrap(api.DELETE("/api/v1/report-templates/{templateId}", { params: { path: { templateId } } }));
}

export function draftBlocksLoader(api: ApiClient, projectId: string, reportId: string): LoadBlocks {
  return (key, cursor) => listSectionBlocks(api, projectId, reportId, key, cursor);
}

/**
 * Adapts the paged-across-sections document endpoint into a per-section `LoadBlocks` (Ruling R-3).
 * One memo of document pages per loader instance, keyed by document cursor (`""` for the first
 * page); in-flight promises are shared and a rejected promise is dropped so a retry refetches.
 *
 * `(key, null)` walks document pages from the first until a page has a section entry with `key`,
 * then returns the concatenated blocks of the contiguous run of entries with that key starting
 * there. `(key, cursor)` fetches that page directly and takes the leading run (starting at index 0)
 * of entries with `key` — normally just the page's first entry, since a section is only ever
 * continued at the start of the page that follows it.
 *
 * The returned `next_cursor` is the page's `next_cursor` when the run reaches the page's last
 * section entry and the page has a next cursor; otherwise `null` (the run ends within the page, or
 * the page is the last one). A key never found while walking returns `{ items: [], next_cursor:
 * null }`.
 */
export function versionBlocksLoader(
  api: ApiClient,
  projectId: string,
  reportId: string,
  n: number,
): LoadBlocks {
  const memo = new Map<string, Promise<ReportDocumentPage>>();

  function fetchPage(cursor: string | null): Promise<ReportDocumentPage> {
    const memoKey = cursor ?? "";
    const cached = memo.get(memoKey);
    if (cached) return cached;
    const promise = getVersionDocumentPage(api, projectId, reportId, n, cursor);
    memo.set(memoKey, promise);
    promise.catch(() => {
      memo.delete(memoKey);
    });
    return promise;
  }

  function runFrom(page: ReportDocumentPage, key: SectionKey, startIndex: number): BlockPage {
    const items: Block[] = [];
    let idx = startIndex;
    let usedLast = false;
    while (idx < page.sections.length && page.sections[idx].key === key) {
      items.push(...page.sections[idx].blocks);
      usedLast = idx === page.sections.length - 1;
      idx += 1;
    }
    return { items, next_cursor: usedLast && page.next_cursor ? page.next_cursor : null };
  }

  return async (key, cursor) => {
    if (cursor !== null) {
      const page = await fetchPage(cursor);
      return runFrom(page, key, 0);
    }
    let pageCursor: string | null = null;
    for (;;) {
      const page = await fetchPage(pageCursor);
      const startIndex = page.sections.findIndex((s) => s.key === key);
      if (startIndex !== -1) return runFrom(page, key, startIndex);
      if (!page.next_cursor) return { items: [], next_cursor: null };
      pageCursor = page.next_cursor;
    }
  };
}

// ---- snapshot / asset URLs (index "SnapshotSpec kinds"; Rulings R-2–R-5) ----

/**
 * A JSON string exactly as Python's json.dumps(ensure_ascii=True) writes it: every UTF-16 code unit
 * from U+007F (DEL, which ensure_ascii escapes too) up becomes a lowercase `\uXXXX` escape (a
 * surrogate pair becomes two escapes, matching ensure_ascii).
 */
function pyString(s: string): string {
  const json = JSON.stringify(s);
  let out = "";
  for (let i = 0; i < json.length; i += 1) {
    const code = json.charCodeAt(i);
    out += code >= 0x7f ? `\\u${code.toString(16).padStart(4, "0")}` : json[i];
  }
  return out;
}

/**
 * `json.dumps(spec, sort_keys=True, separators=(",", ":"))`, the backend's canonical form
 * (Ruling R-4). `undefined` keys are dropped; `null` is kept; non-finite numbers are refused.
 * Byte parity with Python holds for numbers with 1e-4 <= |x| < 1e21 (R3's fixture guarantees only
 * that range); outside it JavaScript's and Python's exponent formatting differ.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string") return pyString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("a snapshot spec cannot hold a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${pyString(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
  }
  throw new Error(`a snapshot spec cannot hold a ${typeof value}`);
}

/** Unpadded base64url of the canonical JSON (ASCII-only, so btoa is safe). */
export function specParam(spec: SnapshotSpec): string {
  return btoa(canonicalJson(spec)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * `GET /projects/{id}/report-snapshots/{key}?spec=`. Without `backend` the origin-less path; with
 * it, the full URL for an `<img src>`, token in the query because images cannot send headers
 * (Ruling R-2). `projectId` and the snapshot key are `encodeURIComponent`'d.
 */
export function snapshotUrl(
  projectId: string,
  ref: Pick<SnapshotRef, "key" | "spec">,
  backend?: { baseUrl: string; token: string },
): string {
  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/report-snapshots/${encodeURIComponent(ref.key)}`;
  const q = new URLSearchParams({ spec: specParam(ref.spec) });
  if (!backend) return `${path}?${q}`;
  q.set("token", backend.token);
  return `${backend.baseUrl.replace(/\/$/, "")}${path}?${q}`;
}

/**
 * `GET /projects/{id}/report-assets/{assetId}`, for the cover logo in the live preview (Ruling
 * R-5). Same shape as `snapshotUrl`: origin-less without `backend`, a `?token=` query with it.
 * `projectId` and `assetId` are `encodeURIComponent`'d. The endpoint itself is only ever used as an
 * `<img src>`, never through the typed client.
 */
export function reportAssetUrl(
  projectId: string,
  assetId: string,
  backend?: { baseUrl: string; token: string },
): string {
  const path = `/api/v1/projects/${encodeURIComponent(projectId)}/report-assets/${encodeURIComponent(assetId)}`;
  if (!backend) return path;
  const q = new URLSearchParams({ token: backend.token });
  return `${backend.baseUrl.replace(/\/$/, "")}${path}?${q}`;
}

// ---- hooks (Ruling 1: keyed state, no synchronous setState in effects) ----

export interface PagedList<T> {
  items: T[];
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface PagedState<T> {
  key: string;
  items: T[];
  next: string | null;
  error: string | null;
}

function idOf(item: unknown): string {
  const o = item as { id?: unknown; number?: unknown };
  return String(o.id ?? o.number);
}

function usePagedList<T>(key: string, load: (cursor?: string) => Promise<Page<T>>): PagedList<T> {
  const [revision, setRevision] = useState(0);
  const fullKey = `${key}#${revision}`;
  const [state, setState] = useState<PagedState<T> | null>(null);
  // The list key/revision whose loadMore is in flight: a reload starts a new revision, so a loadMore
  // after it is not blocked by the old revision's request (whose answer is dropped by the key check).
  const busy = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    load().then(
      (page) => {
        if (!cancelled) setState({ key: fullKey, items: page.items, next: page.next_cursor, error: null });
      },
      (e: unknown) => {
        if (!cancelled)
          setState({ key: fullKey, items: [], next: null, error: messageOf(e, "could not load the list") });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [fullKey, load]);

  const current = state?.key === fullKey ? state : null;

  const loadMore = useCallback(() => {
    if (!current?.next || busy.current === fullKey) return;
    const cursor = current.next;
    busy.current = fullKey;
    load(cursor)
      .then((page) =>
        setState((s) => {
          if (!s || s.key !== fullKey) return s;
          const seen = new Set(s.items.map(idOf));
          const fresh = page.items.filter((i) => !seen.has(idOf(i)));
          // The Prism mock answers the same cursor forever; a repeated cursor ends the list.
          const next = page.next_cursor === cursor ? null : page.next_cursor;
          return { ...s, items: [...s.items, ...fresh], next };
        }),
      )
      .catch((e: unknown) =>
        setState((s) => (s && s.key === fullKey ? { ...s, error: messageOf(e, "could not load more") } : s)),
      )
      .finally(() => {
        if (busy.current === fullKey) busy.current = null;
      });
  }, [current, fullKey, load]);

  const reload = useCallback(() => setRevision((r) => r + 1), []);
  return {
    items: current?.items ?? [],
    loading: current === null,
    error: current?.error ?? null,
    hasMore: Boolean(current?.next),
    loadMore,
    reload,
  };
}

export function useReports(projectId: string): PagedList<ReportListItem> {
  const api = useApi();
  const load = useCallback(
    (cursor?: string) => listReports(api, projectId, cursor) as Promise<Page<ReportListItem>>,
    [api, projectId],
  );
  return usePagedList(`reports:${projectId}`, load);
}

export function useReportVersions(projectId: string, reportId: string): PagedList<ReportVersion> {
  const api = useApi();
  const load = useCallback(
    (cursor?: string) => listVersions(api, projectId, reportId, cursor) as Promise<Page<ReportVersion>>,
    [api, projectId, reportId],
  );
  const list = usePagedList(`versions:${projectId}/${reportId}`, load);
  useOnJobsFinished("report_render", list.reload);
  return list;
}

export function useReportTemplates(): PagedList<ReportTemplate> {
  const api = useApi();
  const load = useCallback(
    (cursor?: string) => listTemplates(api, cursor) as Promise<Page<ReportTemplate>>,
    [api],
  );
  return usePagedList("templates", load);
}

export function useReport(
  projectId: string,
  reportId: string,
): {
  report: Report | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setReport: (report: Report) => void;
} {
  const api = useApi();
  const [revision, setRevision] = useState(0);
  const key = `${projectId}/${reportId}#${revision}`;
  const [state, setState] = useState<{ key: string; report: Report | null; error: string | null } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    getReport(api, projectId, reportId).then(
      (report) => {
        if (!cancelled) setState({ key, report, error: null });
      },
      (e: unknown) => {
        if (!cancelled) setState({ key, report: null, error: messageOf(e, "could not load the report") });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, projectId, reportId, key]);
  const current = state?.key === key ? state : null;
  const setReport = useCallback((report: Report) => setState({ key, report, error: null }), [key]);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  return {
    report: current?.report ?? null,
    loading: current === null,
    error: current?.error ?? null,
    reload,
    setReport,
  };
}

/** The outline, kept across reloads of the same report so the preview never blanks on an edit. */
export function useReportOutline(
  projectId: string,
  reportId: string,
): { outline: ReportOutline | null; refreshing: boolean; error: string | null; reload: () => void } {
  const api = useApi();
  const [revision, setRevision] = useState(0);
  const report = `${projectId}/${reportId}`;
  const [state, setState] = useState<{
    report: string;
    revision: number;
    outline: ReportOutline | null;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getOutline(api, projectId, reportId).then(
      (outline) => {
        if (!cancelled) setState({ report, revision, outline, error: null });
      },
      (e: unknown) => {
        if (!cancelled)
          setState((s) => ({
            report,
            revision,
            outline: s?.report === report ? s.outline : null,
            error: messageOf(e, "could not load the preview"),
          }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [api, projectId, reportId, report, revision]);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const mine = state?.report === report ? state : null;
  return {
    outline: mine?.outline ?? null,
    refreshing: mine?.revision !== revision,
    error: mine?.error ?? null,
    reload,
  };
}

interface LoaderCacheEntry {
  draft: Map<string, LoadBlocks>;
  version: Map<string, LoadBlocks>;
}

/** `cache.get(api)`, creating the (empty) entry on first use — never mutates a hook's return value. */
function loaderCacheFor(cache: WeakMap<ApiClient, LoaderCacheEntry>, api: ApiClient): LoaderCacheEntry {
  let entry = cache.get(api);
  if (!entry) {
    entry = { draft: new Map(), version: new Map() };
    cache.set(api, entry);
  }
  return entry;
}

/**
 * `blocksLoader`/`versionLoader` are memoised per source (Ruling 9: `loadBlocks` must be stable for
 * one source). `versionBlocksLoader` keeps its own per-instance document-page memo (Ruling R-3), so a
 * fresh loader on every call would defeat it. The cache is a `WeakMap` keyed by the live `ApiClient`
 * (so a new client, e.g. after a backend reconnect, never reuses a loader bound to the old one) of
 * `Map`s keyed by a string that folds in `projectId` (so a `projectId` change on the same client
 * can't return a stale loader either); `\u0000` cannot occur in a project/report id or a version
 * number, so it's a safe separator. Looked up synchronously inside the closures below — no effect,
 * no conditional read of `ref.current` during render.
 */
export function useReportActions(projectId: string) {
  const api = useApi();
  const caches = useRef(new WeakMap<ApiClient, LoaderCacheEntry>());
  return useMemo(
    () => ({
      create: (body: ReportCreate) => createReport(api, projectId, body),
      patch: (reportId: string, body: ReportPatch) => patchReport(api, projectId, reportId, body),
      remove: (reportId: string) => deleteReport(api, projectId, reportId),
      duplicate: (reportId: string) => duplicateReport(api, projectId, reportId),
      render: async (reportId: string, body: RenderRequest) => {
        const ref = await startRender(api, projectId, reportId, body);
        useJobsStore.getState().upsert(ref.job);
        return ref;
      },
      setIssued: (reportId: string, n: number, issued: boolean) =>
        setVersionIssued(api, projectId, reportId, n, issued),
      deleteVersion: (reportId: string, n: number) => deleteVersion(api, projectId, reportId, n),
      open: (path: string) => openProjectFile(api, projectId, path),
      importLogo: (path: string) => importReportAsset(api, projectId, path),
      blocksLoader: (reportId: string): LoadBlocks => {
        const entry = loaderCacheFor(caches.current, api);
        const key = `${projectId}\u0000${reportId}`;
        let loader = entry.draft.get(key);
        if (!loader) {
          loader = draftBlocksLoader(api, projectId, reportId);
          entry.draft.set(key, loader);
        }
        return loader;
      },
      versionLoader: (reportId: string, n: number): LoadBlocks => {
        const entry = loaderCacheFor(caches.current, api);
        const key = `${projectId}\u0000${reportId}\u0000${n}`;
        let loader = entry.version.get(key);
        if (!loader) {
          loader = versionBlocksLoader(api, projectId, reportId, n);
          entry.version.set(key, loader);
        }
        return loader;
      },
    }),
    [api, projectId],
  );
}

export function useTemplateActions() {
  const api = useApi();
  return useMemo(
    () => ({
      create: (body: TemplateCreate) => createTemplate(api, body),
      patch: (templateId: string, body: TemplatePatch) => patchTemplate(api, templateId, body),
      remove: (templateId: string) => deleteTemplate(api, templateId),
    }),
    [api],
  );
}

/** Snapshot `<img src>` resolver; null outside an ApiProvider (the gallery), never a throw. */
export function useSnapshotSrc(projectId: string): (ref: SnapshotRef) => string | null {
  const info = useContext(ApiContext)?.info ?? null;
  return useCallback(
    (ref: SnapshotRef) => (info ? snapshotUrl(projectId, ref, info) : null),
    [info, projectId],
  );
}

/** Cover-logo `<img src>` resolver for the live preview (Ruling R-5); same soft-context pattern. */
export function useReportAssetSrc(projectId: string): (assetId: string) => string | null {
  const info = useContext(ApiContext)?.info ?? null;
  return useCallback(
    (assetId: string) => (info ? reportAssetUrl(projectId, assetId, info) : null),
    [info, projectId],
  );
}
