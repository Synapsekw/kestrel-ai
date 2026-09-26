/* eslint-disable react-refresh/only-export-components --
   the provider and the hooks that read its context belong to one module; this file is not
   a fast-refresh boundary worth splitting. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { ApiClient, Health } from "@contract/client";
import { resolveBackend, terminationMessage, waitForHealth, type BackendInfo } from "./backend";
import { createBackendClient } from "./timeoutFetch";
import { Splash } from "@/app/Splash";
import { Button, Icon } from "@/ui";
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
        const client = createBackendClient({ baseUrl: resolved.baseUrl, token: resolved.token });
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
    <div className="flex h-full w-full items-center justify-center bg-bg p-8 text-ink">
      <div
        role="alertdialog"
        aria-labelledby="backend-failure-title"
        className="flex max-w-xl flex-col gap-4 rounded-lg border border-line bg-surface p-6 shadow-float"
      >
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
            <Icon name="warning" size={16} />
          </span>
          <h1 id="backend-failure-title" className="text-base font-semibold">
            The backend is not responding
          </h1>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">{error}</p>
        <dl className="grid grid-cols-[5rem_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted">URL</dt>
          <dd className="font-mono text-xs">{info?.baseUrl ?? "unknown"}</dd>
          <dt className="text-muted">Mode</dt>
          <dd className="font-mono text-xs">{info?.mode ?? "unknown"}</dd>
          {info?.logPath ? (
            <>
              <dt className="text-muted">Log</dt>
              <dd className="break-all font-mono text-xs">{info.logPath}</dd>
            </>
          ) : null}
        </dl>
        <Button variant="primary" icon="refresh" onClick={onRestart} className="self-start">
          Restart
        </Button>
      </div>
    </div>
  );
}
