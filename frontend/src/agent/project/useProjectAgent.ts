import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import type {
  AgentConversation,
  AgentItem,
  AgentNavigate,
  AgentTurn,
  Provider,
  ProviderName,
} from "@contract/client";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { fetchJob } from "@/api/jobs";
import {
  cancelTurn,
  clearConversation,
  decideApproval,
  fetchConversation,
  startTurn,
} from "@/api/projectAgent";
import { useProviders } from "@/api/providers";
import { pushLog } from "@/app/diagnostics";
import { useJobsStore } from "@/store/jobs";
import { useProjectAgentEvents } from "./agentEvents";

export const PROVIDER_STORAGE_KEY = "kestrel.agent.provider";
export const MESSAGE_MAX = 4000;
const DEBOUNCE_MS = 150;
const POLL_MS = 3000;

const SCREEN_PATH: Record<Exclude<AgentNavigate["screen"], "home" | "editor">, string> = {
  images: "data",
  label: "label",
  review: "review",
  datasets: "datasets",
  models: "models",
  train: "train",
  detect: "query",
  export: "export",
  settings: "settings",
};

/** The route an `open_screen` item points at; null for an editor target without an image. */
export function screenRoute(projectId: string, nav: AgentNavigate): string | null {
  const base = `/p/${projectId}`;
  if (nav.screen === "home") return base;
  if (nav.screen === "editor") return nav.image_id ? `${base}/edit/${nav.image_id}` : null;
  return `${base}/${SCREEN_PATH[nav.screen]}`;
}

function isProviderName(v: unknown): v is ProviderName {
  return v === "openai" || v === "anthropic";
}

function readStoredProvider(): ProviderName | null {
  try {
    const v = localStorage.getItem(PROVIDER_STORAGE_KEY);
    return isProviderName(v) ? v : null;
  } catch {
    return null;
  }
}

function storeProvider(p: ProviderName) {
  try {
    localStorage.setItem(PROVIDER_STORAGE_KEY, p);
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}

export interface ProjectAgentState {
  items: AgentItem[];
  turn: AgentTurn | null;
  /** A turn is running. */
  busy: boolean;
  /** A turn waits on the approval card. */
  awaiting: boolean;
  /** A request from this drawer (send, stop, decide, clear) is in flight. */
  pending: boolean;
  /** The first conversation read finished. */
  loaded: boolean;
  provider: ProviderName;
  setProvider: (p: ProviderName) => void;
  providers: Provider[];
  providersReady: boolean;
  providersError: string | null;
  hasKey: (p: ProviderName) => boolean;
  message: string;
  setMessage: (s: string) => void;
  send: () => Promise<void>;
  stop: () => Promise<void>;
  decide: (approve: boolean) => Promise<void>;
  clear: () => Promise<void>;
  error: string | null;
}

export function useProjectAgent(projectId: string, open: boolean): ProjectAgentState {
  const api = useApi();
  const navigate = useNavigate();
  const navigateRef = useRef<NavigateFunction>(navigate);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const providerList = useProviders();
  const { reload: reloadProviders } = providerList;
  const [chosen, setChosen] = useState<ProviderName | null>(readStoredProvider);
  const [conv, setConv] = useState<AgentConversation | null>(null);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const locked = useRef(false);
  const alive = useRef(true);
  const request = useRef(0);
  /** Highest seq seen by the first read after opening; `open_screen` items at or below it are history. */
  const baseline = useRef<number | null>(null);
  const seenRevision = useRef(0);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const next = await fetchConversation(api, projectId);
      if (!alive.current || id !== request.current) return;
      setConv(next);
      setLoadError(null);
      const maxSeq = next.items.reduce((m, i) => Math.max(m, i.seq), 0);
      if (baseline.current === null) {
        baseline.current = maxSeq;
        return;
      }
      const since = baseline.current;
      baseline.current = Math.max(since, maxSeq);
      const target = next.items.filter((i) => i.seq > since && i.navigate).at(-1)?.navigate;
      const to = target ? screenRoute(projectId, target) : null;
      if (to) navigateRef.current(to);
    } catch (e) {
      if (!alive.current || id !== request.current) return;
      pushLog(`load agent conversation failed: ${messageOf(e, "unknown error")}`);
      setLoadError(messageOf(e, "Could not load the conversation. Close and reopen the drawer to retry."));
    }
  }, [api, projectId]);

  // Opening reads the conversation and treats everything in it as history (no navigation replay).
  const openedOnce = useRef(false);
  useEffect(() => {
    if (!open) return;
    baseline.current = null;
    seenRevision.current = useProjectAgentEvents.getState().revision[projectId] ?? 0;
    // `load` sets state only after the request resolves; this effect syncs with the backend on open.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // Provider keys may have changed in App settings while the drawer was closed.
    if (openedOnce.current) reloadProviders();
    openedOnce.current = true;
  }, [open, load, projectId, reloadProviders]);

  const revision = useProjectAgentEvents((s) => s.revision[projectId] ?? 0);
  useEffect(() => {
    if (!open || revision === seenRevision.current) return;
    seenRevision.current = revision;
    const t = setTimeout(() => void load(), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [open, revision, load]);

  const turn = conv?.turn ?? null;
  const busy = turn?.state === "running";
  const awaiting = turn?.state === "awaiting_approval";

  // Fallback when an event is missed while a turn runs.
  useEffect(() => {
    if (!open || !busy) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [open, busy, load]);

  // Jobs the agent started are unknown to the jobs store until read once; events keep them live after.
  const items = conv?.items;
  const requestedJobs = useRef(new Set<string>());
  useEffect(() => {
    if (!items) return;
    const known = useJobsStore.getState().jobs;
    for (const item of items) {
      for (const jobId of item.job_ids) {
        if (known[jobId] || requestedJobs.current.has(jobId)) continue;
        requestedJobs.current.add(jobId);
        fetchJob(api, projectId, jobId)
          .then((job) => useJobsStore.getState().upsert(job))
          .catch((e: unknown) => pushLog(`load agent job failed: ${messageOf(e, "unknown error")}`));
      }
    }
  }, [api, projectId, items]);

  const providers = providerList.providers;
  const hasKey = useCallback(
    (p: ProviderName) => providers.some((x) => x.name === p && x.has_key),
    [providers],
  );
  const provider: ProviderName =
    chosen ?? providers.find((p) => p.has_key)?.name ?? providers[0]?.name ?? "openai";
  const setProvider = useCallback((p: ProviderName) => {
    setChosen(p);
    storeProvider(p);
  }, []);

  const act = useCallback(async (fallback: string, action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      if (alive.current) setActionError(messageOf(e, fallback));
    } finally {
      locked.current = false;
      if (alive.current) setPending(false);
    }
  }, []);

  const withTurn = (t: AgentTurn) => setConv((c) => ({ items: c?.items ?? [], turn: t }));

  const send = async () => {
    const text = message.trim();
    if (!text || busy || awaiting || !hasKey(provider)) return;
    await act("The message could not be sent. Try again.", async () => {
      const t = await startTurn(api, projectId, { provider, message: text.slice(0, MESSAGE_MAX) });
      setMessage("");
      withTurn(t);
      await load();
    });
  };

  const stop = async () => {
    if (!turn || !busy) return;
    await act("The agent could not be stopped. Try again.", async () => {
      withTurn(await cancelTurn(api, projectId, turn.id));
      await load();
    });
  };

  const decide = async (approve: boolean) => {
    if (!turn || !awaiting) return;
    await act("The decision could not be sent. Try again.", async () => {
      withTurn(await decideApproval(api, projectId, turn.id, approve));
      await load();
    });
  };

  const clear = async () => {
    if (busy || awaiting) return;
    await act("The conversation could not be cleared. Try again.", async () => {
      await clearConversation(api, projectId);
      request.current += 1; // drop a read that started before the clear
      baseline.current = 0;
      setConv({ items: [], turn: null });
    });
  };

  return {
    items: conv?.items ?? [],
    turn,
    busy,
    awaiting,
    pending,
    loaded: conv !== null,
    provider,
    setProvider,
    providers,
    providersReady: !providerList.loading,
    providersError: providerList.error,
    hasKey,
    message,
    setMessage,
    send,
    stop,
    decide,
    clear,
    error: actionError ?? loadError,
  };
}
