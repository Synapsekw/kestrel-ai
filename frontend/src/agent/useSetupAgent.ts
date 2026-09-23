import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type {
  CostEstimate,
  ImagePage,
  Job,
  Project,
  Provider,
  ProviderName,
  QueryRunCreate,
  StarterModel,
} from "@contract/client";
import { useApi } from "@/api/client";
import { chatWithAgent, type AgentMessage, type AgentPlan } from "@/api/agent";
import { messageOf, unwrap } from "@/api/errors";
import { fetchProviders } from "@/api/providers";
import { acquireStarter, LIBRARY_JOBS } from "@/api/library";
import { listStarterModels } from "@/api/starterModels";
import { createSource } from "@/api/sources";
import { fetchImagePage } from "@/api/images";
import { cancelJob, fetchJob } from "@/api/jobs";
import {
  createQueryRun,
  estimateQueryRun,
  resumeQueryRun,
  DEFAULT_CONF,
  DEFAULT_TILING,
} from "@/api/queryRuns";
import { isActiveJob, useJobsStore } from "@/store/jobs";

type Stage = "starter" | "import" | "label";
const COLOURS = ["#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7"];
export function useSetupAgent(open: boolean) {
  const api = useApi();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [provider, setProvider] = useState<ProviderName>("openai");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [catalog, setCatalog] = useState<StarterModel[]>([]);
  const [metadataRevision, refreshMetadata] = useState(0);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState<AgentPlan | null>(null);
  const [folder, setFolder] = useState("");
  const [project, setProject] = useState<Project | null>(null);
  const [sourceFolder, setSourceFolder] = useState("");
  const [jobs, setJobs] = useState<Partial<Record<Stage, Job>>>({});
  const [pollError, setPollError] = useState<string | null>(null);
  const [page, setPage] = useState<ImagePage | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [estimate, setEstimate] = useState<{ key: string; value: CostEstimate } | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const locked = useRef(false);
  const projectRef = useRef<Project | null>(null);
  const importRead = useRef<string | null>(null);
  const pageRequest = useRef(0);

  useEffect(() => {
    if (!open) return;
    let ignore = false;
    // Refresh external provider readiness whenever the drawer opens or settings navigation changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMetadataLoading(true);
    setMetadataError(null);
    // Model and pricing may have changed in App settings while this drawer was closed.
    setEstimate(null);
    void Promise.all([fetchProviders(api), listStarterModels(api)])
      .then(([p, c]) => {
        if (!ignore) {
          setProviders(p);
          setCatalog(c);
        }
      })
      .catch((e: unknown) => {
        if (!ignore) setMetadataError(messageOf(e, "Could not load providers and starters. Retry."));
      })
      .finally(() => {
        if (!ignore) setMetadataLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [api, open, pathname, metadataRevision]);

  const act = useCallback(async (name: string, action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setBusy(name);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(messageOf(e, "This step could not finish. Try again."));
    } finally {
      locked.current = false;
      setBusy(null);
    }
  }, []);
  const remember = useCallback((stage: Stage, job: Job) => {
    setJobs((s) => ({ ...s, [stage]: job }));
    useJobsStore.getState().upsert(job);
  }, []);
  const activeKey = Object.entries(jobs)
    .filter(([, j]) => isActiveJob(j))
    .map(([stage, j]) => `${stage}:${j.id}`)
    .join(",");
  useEffect(() => {
    if (!project || !activeKey) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    const entries = activeKey.split(",").map((s) => s.split(":"));
    async function poll() {
      try {
        const updates = await Promise.all(
          entries.map(async ([stage, id]) => ({
            stage: stage as Stage,
            // The starter download is a library job; the others belong to the project.
            job: await fetchJob(api, stage === "starter" ? LIBRARY_JOBS : project!.id, id),
          })),
        );
        if (disposed) return;
        for (const u of updates) remember(u.stage, u.job);
        setPollError(null);
      } catch {
        if (!disposed)
          setPollError("Progress could not refresh. Reconnecting; your job continues in the background.");
      }
      if (!disposed) timer = setTimeout(() => void poll(), 1500);
    }
    void poll();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [api, project, activeKey, remember]);

  const loadPage = useCallback(
    async (cursor?: string) => {
      if (!projectRef.current) return;
      const sequence = ++pageRequest.current;
      const result = await fetchImagePage(api, projectRef.current.id, {
        limit: 24,
        ...(cursor ? { cursor } : {}),
        sort: "path",
        order: "asc",
      });
      if (sequence === pageRequest.current) setPage(result);
    },
    [api],
  );
  useEffect(() => {
    const job = jobs.import;
    if (!job || isActiveJob(job) || importRead.current === job.id) return;
    importRead.current = job.id;
    void loadPage().catch(() => setError("Could not load images. Use Refresh images to try again."));
  }, [jobs.import, loadPage]);

  const currentProvider = providers.find((p) => p.name === provider);
  const ready = !!currentProvider?.has_key && !metadataLoading && !metadataError;
  const body: QueryRunCreate = {
    kind: "cloud_provider",
    provider,
    query: query.trim(),
    image_ids: selected,
    tiling: DEFAULT_TILING,
    conf: DEFAULT_CONF,
  };
  const estimateKey = JSON.stringify(body);
  const validEstimate = estimate?.key === estimateKey ? estimate.value : null;
  const validPlan =
    !!plan &&
    !!plan.name.trim() &&
    plan.name.length <= 120 &&
    plan.classes.length > 0 &&
    plan.classes.length <= 32 &&
    plan.classes.every((c) => c.trim().length > 0 && c.length <= 64) &&
    new Set(plan.classes.map((c) => c.trim().toLocaleLowerCase())).size === plan.classes.length &&
    catalog.some((c) => c.key === plan.starter_model_key);
  const batchReady =
    ready && selected.length > 0 && selected.length <= 24 && !!query.trim() && query.length <= 2000;
  const send = () =>
    act("chat", async () => {
      if (!ready || !message.trim()) return;
      const outgoing: AgentMessage[] = [...messages, { role: "user", content: message.trim() }];
      const response = await chatWithAgent(api, { provider, messages: outgoing, plan });
      setMessages([...outgoing, { role: "assistant" as const, content: response.message }].slice(-24));
      setMessage("");
      // A created project's reviewed plan is frozen. Later conversation supplies guidance only.
      if (!projectRef.current && response.plan) {
        setPlan(response.plan);
        setQuery(response.plan.labeling_query);
      }
    });
  const create = () =>
    act("create", async () => {
      if (!validPlan || !plan || !folder.trim()) return;
      let p = projectRef.current;
      if (!p) {
        p = await unwrap(
          api.POST("/api/v1/projects", {
            body: {
              name: plan.name.trim(),
              folder: folder.trim(),
              kind: "train",
              classes: plan.classes.map((name, i) => ({
                name: name.trim(),
                colour: COLOURS[i % COLOURS.length],
                hotkey: i < 9 ? String(i + 1) : null,
              })),
            },
          }),
        );
        projectRef.current = p;
        setProject(p);
        void navigate(`/p/${p.id}`);
      }
      remember("starter", await acquireStarter(api, plan.starter_model_key));
    });
  const acquire = () =>
    act("starter", async () => {
      if (project && plan)
        remember("starter", await acquireStarter(api, plan.starter_model_key));
    });
  const importImages = () =>
    act("import", async () => {
      if (!project || !sourceFolder.trim()) return;
      const result = await createSource(api, project.id, { folder: sourceFolder.trim() });
      importRead.current = null;
      remember("import", result.job);
    });
  const calculate = () =>
    act("estimate", async () => {
      if (!project || !batchReady) return;
      setEstimate(null);
      const value = await estimateQueryRun(api, project.id, body);
      setEstimate({ key: estimateKey, value });
    });
  const start = () =>
    act("label", async () => {
      if (!project || !batchReady || !validEstimate || runId) return;
      const result = await createQueryRun(api, project.id, body);
      setRunId(result.query_run.id);
      remember("label", result.job);
    });
  const resume = () =>
    act("resume", async () => {
      if (project && runId) remember("label", await resumeQueryRun(api, project.id, runId));
    });
  const cancel = (stage: Stage) =>
    act("cancel", async () => {
      const job = jobs[stage];
      if (project && job)
        remember(stage, await cancelJob(api, stage === "starter" ? LIBRARY_JOBS : project.id, job.id));
    });
  const toggle = (id: string) => {
    setEstimate(null);
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 24 ? [...s, id] : s));
  };
  const changeProvider = (value: ProviderName) => {
    setEstimate(null);
    setProvider(value);
  };
  const changeQuery = (value: string) => {
    setEstimate(null);
    setQuery(value);
  };
  const canReset = !!project && !busy && !Object.values(jobs).some(isActiveJob);
  const reset = () => {
    if (!canReset || locked.current) return;
    projectRef.current = null;
    importRead.current = null;
    pageRequest.current += 1;
    setProject(null);
    setPlan(null);
    setMessages([]);
    setMessage("");
    setFolder("");
    setSourceFolder("");
    setJobs({});
    setPage(null);
    setSelected([]);
    setQuery("");
    setEstimate(null);
    setRunId(null);
    setError(null);
    setPollError(null);
  };
  return {
    canReset,
    reset,
    provider,
    setProvider: changeProvider,
    currentProvider,
    ready,
    catalog,
    metadataError,
    metadataLoading,
    refreshMetadata: () => refreshMetadata((n) => n + 1),
    message,
    setMessage,
    messages,
    plan,
    setPlan,
    folder,
    setFolder,
    project,
    sourceFolder,
    setSourceFolder,
    jobs,
    pollError,
    page,
    selected,
    toggle,
    query,
    setQuery: changeQuery,
    estimate: validEstimate,
    runId,
    error,
    busy,
    validPlan,
    batchReady,
    send,
    create,
    acquire,
    importImages,
    calculate,
    start,
    resume,
    cancel,
    refreshImages: (cursor?: string) => act("images", () => loadPage(cursor)),
  };
}
