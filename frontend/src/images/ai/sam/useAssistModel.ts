import { useCallback, useEffect, useState } from "react";
import type { Job } from "@contract/client";
import { useApi } from "@/api/client";
import { ApiFailure, codeOf, messageOf } from "@/api/errors";
import { isActiveJob, useJobsStore } from "@/store/jobs";
import { toast } from "@/ui";
import { acquireAssistModel, importAssistModel, listAssistModels, type AssistModel } from "../api";

/**
 * `unavailable`: SAM failed to load last time; the server retries on every prepare/segment (I-BS),
 * so S still tries. `absent`: the assist routes are not in this build (the list answers 404), the one
 * state that does not change within a session.
 */
export type Availability = "loading" | "ready" | "missing" | "invalid" | "unavailable" | "absent";

/** The SAM weights' state (spec §10 "Weights", §16); reloads when its acquire job ends. */
export function useAssistModel() {
  const api = useApi();
  const [model, setModel] = useState<AssistModel | null>(null);
  const [availability, setAvailability] = useState<Availability>("loading");
  const [nonce, setNonce] = useState(0);
  const [trackedJob, setTrackedJob] = useState<string | null>(null);
  const jobId = trackedJob ?? model?.job_id ?? null;
  const job = useJobsStore((s) => (jobId ? (s.jobs[jobId] ?? null) : null));

  useEffect(() => {
    let cancelled = false;
    listAssistModels(api)
      .then((items) => {
        if (cancelled) return;
        const m = items.find((x) => x.key === "sam2.1_t") ?? null;
        setModel(m);
        setAvailability(m ? m.state : "unavailable");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // 404: no assist routes (the router failed to import in this build). Anything else (a 503
        // without a library, a network blip) is recoverable through `reload()`.
        setAvailability(e instanceof ApiFailure && e.status === 404 ? "absent" : "unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [api, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  // The acquire job ended: read the catalogue again (on the jobs store's change, not in render).
  useEffect(() => {
    if (!jobId) return;
    return useJobsStore.subscribe((s, prev) => {
      const j = s.jobs[jobId];
      if (j && j !== prev.jobs[jobId] && !isActiveJob(j)) reload();
    });
  }, [jobId, reload]);

  const track = useCallback((j: Job) => {
    useJobsStore.getState().upsert(j);
    setTrackedJob(j.id);
  }, []);

  const getModel = useCallback(() => {
    acquireAssistModel(api, "sam2.1_t")
      .then(track)
      .catch((e: unknown) => {
        // A download already running (409 job_running {job_id}): follow that job instead.
        const running = codeOf(e) === "job_running" ? (e as ApiFailure).details.job_id : null;
        if (typeof running === "string") setTrackedJob(running);
        else toast("danger", `Could not start the download: ${messageOf(e, "unknown error")}`);
      });
  }, [api, track]);

  const importFile = useCallback(async () => {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "SAM weights", extensions: ["pt"] }],
      });
      if (typeof picked !== "string") return;
      track(await importAssistModel(api, "sam2.1_t", picked));
    } catch (e) {
      toast("danger", `Could not import the file: ${messageOf(e, "unknown error")}`);
    }
  }, [api, track]);

  return { model, availability, job, getModel, importFile, reload };
}
