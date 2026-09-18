/* eslint-disable react-refresh/only-export-components --
   the provider and the hooks that read its context belong to one module; this file is not
   a fast-refresh boundary worth splitting. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { createApiClient, type ApiClient, type Health } from "@contract/client";
import { resolveBackend, terminationMessage, waitForHealth, type BackendInfo } from "./backend";
import { Splash } from "@/app/Splash";
import { pushLog, setBackendContext } from "@/app/diagnostics";

export interface ApiContextValue {
  client: ApiClient;
  info: BackendInfo;
  health: Health;
}

export const ApiContext = createContext<ApiContextValue | null>(null);

function useApiContext(): ApiContextValue {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error("useApi must be used inside <ApiProvider>");
  return ctx;
}

export function useApi(): ApiClient {
  return useApiContext().client;
}

export function useBackend(): BackendInfo {
  return useApiContext().info;
}

/**
 * Resolves the backend, polls health and only then renders the app.
 * While polling it shows the splash; on failure it blocks with a restart dialog.
 */
export function ApiProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<ApiContextValue | null>(null);
  const [info, setInfo] = useState<BackendInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resolved = await resolveBackend();
        if (cancelled) return;
        setInfo(resolved);
        setBackendContext(resolved, null);
        pushLog(`backend: ${resolved.mode} at ${resolved.baseUrl}`);
        const client = createApiClient({ baseUrl: resolved.baseUrl, token: resolved.token });
        const health = await waitForHealth(client);
        if (cancelled) return;
        setBackendContext(resolved, health);
        pushLog(`health: ${JSON.stringify(health)}`);
        setValue({ client, info: resolved, health });
      } catch (e) {
        if (cancelled) return;
        pushLog(`backend unavailable: ${e}`);
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  // Spec section 11: the sidecar can die while the app runs, and the UI has to notice.
  useEffect(() => {
    if (info?.mode !== "tauri") return;
    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const stop = await listen("backend-terminated", (event) => {
        pushLog(`backend terminated: ${JSON.stringify(event.payload)}`);
        setError(terminationMessage(event.payload));
      });
      if (cancelled) stop();
      else unlisten = stop;
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [info]);

  const restart = useCallback(async () => {
    setValue(null);
    setError(null);
    if (info?.mode === "tauri") {
      const { invoke } = await import("@tauri-apps/api/core");
      try {
        await invoke("restart_backend");
      } catch (e) {
        pushLog(`restart_backend failed: ${e}`);
      }
    }
    setAttempt((a) => a + 1);
  }, [info]);

  if (error) return <BackendFailure error={error} info={info} onRestart={restart} />;
  if (!value) return <Splash />;
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

function BackendFailure({
  error,
  info,
  onRestart,
}: {
  error: string;
  info: BackendInfo | null;
  onRestart: () => void;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-slate-900 p-8 text-slate-100">
      <div
        role="alertdialog"
        aria-labelledby="backend-failure-title"
        className="max-w-xl rounded-lg bg-slate-800 p-6 shadow-xl"
      >
        <h1 id="backend-failure-title" className="mb-2 text-xl font-semibold text-orange-400">
          The backend is not responding
        </h1>
        <p className="mb-4 whitespace-pre-wrap text-sm text-slate-300">{error}</p>
        <dl className="mb-6 grid grid-cols-[6rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-400">URL</dt>
          <dd className="font-mono">{info?.baseUrl ?? "unknown"}</dd>
          <dt className="text-slate-400">Mode</dt>
          <dd className="font-mono">{info?.mode ?? "unknown"}</dd>
          {info?.logPath ? (
            <>
              <dt className="text-slate-400">Log</dt>
              <dd className="break-all font-mono">{info.logPath}</dd>
            </>
          ) : null}
        </dl>
        <button
          type="button"
          onClick={onRestart}
          className="rounded bg-orange-600 px-4 py-2 font-medium hover:bg-orange-500"
        >
          Restart
        </button>
      </div>
    </div>
  );
}
