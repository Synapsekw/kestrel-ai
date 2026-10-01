import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import {
  getOutline,
  getReport,
  patchReport,
  type Report,
  type ReportConfig,
  type ReportOutline,
} from "@/api/reports";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { PATCH_DEBOUNCE_MS } from "./builderModel";
import { saveErrorText } from "./format";

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error";

export interface ReportDraft {
  status: "loading" | "ready" | "error";
  loadError: string | null;
  report: Report | null;
  title: string;
  config: ReportConfig | null;
  outline: ReportOutline | null;
  saveState: SaveState;
  saveError: string | null;
  /** The failed save's error code (`invalid_report` for R1's 422), else null. */
  saveErrorCode: string | null;
  setTitle: (title: string) => void;
  edit: (change: (c: ReportConfig) => ReportConfig) => void;
  /**
   * Sends a waiting edit (or re-sends one whose save failed) now, and keeps going while edits land
   * during it; true when everything is saved (Render calls it first).
   */
  flush: () => Promise<boolean>;
  reloadOutline: () => void;
}

interface Local {
  title: string;
  config: ReportConfig;
}

/**
 * The live preview loop (spec §12). Edits apply locally at once. 400 ms after the last one, the whole
 * config goes out as one PATCH. One PATCH is in flight at a time (Review Focus 1). After each save
 * the outline is re-read, and only the latest read lands.
 */
export function useReportDraft(projectId: string, reportId: string): ReportDraft {
  const api = useApi();
  const [report, setReport] = useState<Report | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [local, setLocal] = useState<Local | null>(null);
  const [outline, setOutline] = useState<ReportOutline | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorCode, setSaveErrorCode] = useState<string | null>(null);
  const findingsRevision = useChangesStore((s) => s.findingsRevision);

  const latest = useRef<Local | null>(null);
  const pending = useRef<Local | null>(null);
  /** The body of a save that failed and nothing newer has replaced yet; flush and unmount re-send it. */
  const failed = useRef<Local | null>(null);
  const sendSeq = useRef(0);
  const timer = useRef<number | null>(null);
  const inFlight = useRef<Promise<boolean>>(Promise.resolve(true));
  const outlineSeq = useRef(0);
  const mounted = useRef(true);

  const reloadOutline = useCallback(() => {
    const seq = ++outlineSeq.current;
    getOutline(api, projectId, reportId).then(
      (o) => {
        if (mounted.current && seq === outlineSeq.current) setOutline(o);
      },
      (e: unknown) => pushLog(`report outline failed: ${messageOf(e, String(e))}`),
    );
  }, [api, projectId, reportId]);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    getReport(api, projectId, reportId).then(
      (r) => {
        if (cancelled) return;
        const l = { title: r.title, config: r.config };
        latest.current = l;
        setReport(r);
        setLocal(l);
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(messageOf(e, "could not open the report"));
      },
    );
    reloadOutline();
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [api, projectId, reportId, reloadOutline]);

  /** Takes the waiting edit (else a failed one) and sends it after any save in flight. */
  const send = useCallback((): Promise<boolean> => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    // A newer edit supersedes a failed save; with no newer edit, the failed one is sent again.
    const body = pending.current ?? failed.current;
    if (!body) return inFlight.current;
    pending.current = null;
    failed.current = null;
    const seq = ++sendSeq.current;
    const run = inFlight.current.then(async () => {
      if (mounted.current) setSaveState("saving");
      const title = body.title.trim();
      try {
        const saved = await patchReport(api, projectId, reportId, {
          ...(title ? { title } : {}),
          config: body.config,
        });
        failed.current = null;
        if (mounted.current) {
          setReport(saved);
          setSaveError(null);
          setSaveErrorCode(null);
          setSaveState(pending.current ? "pending" : "saved");
          reloadOutline();
        }
        return true;
      } catch (e) {
        pushLog(`report save failed: ${messageOf(e, String(e))}`);
        // Kept for a retry unless a newer edit is already queued or waiting to replace it.
        if (seq === sendSeq.current && pending.current === null) failed.current = body;
        if (mounted.current) {
          setSaveError(saveErrorText(e));
          setSaveErrorCode(codeOf(e));
          setSaveState("error");
        }
        return false;
      }
    });
    inFlight.current = run;
    return run;
  }, [api, projectId, reportId, reloadOutline]);

  const schedule = useCallback(
    (next: Local) => {
      latest.current = next;
      pending.current = next;
      setLocal(next);
      setSaveState("pending");
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        void send();
      }, PATCH_DEBOUNCE_MS);
    },
    [send],
  );

  const edit = useCallback(
    (change: (c: ReportConfig) => ReportConfig) => {
      const cur = latest.current;
      if (cur) schedule({ title: cur.title, config: change(cur.config) });
    },
    [schedule],
  );

  const setTitle = useCallback(
    (title: string) => {
      const cur = latest.current;
      if (cur) schedule({ title, config: cur.config });
    },
    [schedule],
  );

  // An edit still waiting (or whose save failed) when the builder closes is saved (Review Focus 2).
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(
    () => () => {
      if (pending.current || failed.current) void sendRef.current();
    },
    [],
  );

  // A finding changed somewhere: the counts and the sections may have changed too.
  const seenRevision = useRef(findingsRevision);
  useEffect(() => {
    if (findingsRevision === seenRevision.current) return;
    seenRevision.current = findingsRevision;
    reloadOutline();
  }, [findingsRevision, reloadOutline]);

  const flush = useCallback(async () => {
    // An edit made while a save is in flight is sent too; stop at the first save that fails.
    for (;;) {
      if (!(await send())) return false;
      if (pending.current === null && failed.current === null) return true;
    }
  }, [send]);

  return {
    status: loadError ? "error" : local ? "ready" : "loading",
    loadError,
    report,
    title: local?.title ?? "",
    config: local?.config ?? null,
    outline,
    saveState,
    saveError,
    saveErrorCode,
    setTitle,
    edit,
    flush,
    reloadOutline,
  };
}
