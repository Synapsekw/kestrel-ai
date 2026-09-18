import { useCallback, useEffect, useState } from "react";
import type { ApiClient, Provider, ProviderName, components } from "@contract/client";
import { useApi } from "./client";
import { isNotImplemented, messageOf, unwrap } from "./errors";
import { pushLog } from "@/app/diagnostics";

export type ProviderUpdate = components["schemas"]["ProviderUpdate"];
export type ProviderTestResult = components["schemas"]["ProviderTestResult"];

/** Keys are never returned: `has_key` says whether Credential Manager holds one. 501 until S4 lands. */
export async function fetchProviders(api: ApiClient): Promise<Provider[]> {
  const r = await unwrap(api.GET("/api/v1/providers"));
  return r.items;
}

export function updateProvider(
  api: ApiClient,
  provider: ProviderName,
  patch: ProviderUpdate,
): Promise<Provider> {
  return unwrap(api.PATCH("/api/v1/providers/{provider}", { params: { path: { provider } }, body: patch }));
}

/** The key travels once, in this request body; callers must drop it from state afterwards. Never log it. */
export async function setProviderKey(api: ApiClient, provider: ProviderName, apiKey: string): Promise<void> {
  await unwrap<unknown>(
    api.PUT("/api/v1/providers/{provider}/key", {
      params: { path: { provider } },
      body: { api_key: apiKey },
    }),
  );
}

export async function deleteProviderKey(api: ApiClient, provider: ProviderName): Promise<void> {
  await unwrap<unknown>(api.DELETE("/api/v1/providers/{provider}/key", { params: { path: { provider } } }));
}

export function testProvider(api: ApiClient, provider: ProviderName): Promise<ProviderTestResult> {
  return unwrap(api.POST("/api/v1/providers/{provider}/test", { params: { path: { provider } } }));
}

const LABELS: Record<ProviderName, string> = { openai: "OpenAI", anthropic: "Anthropic" };

export function providerLabel(name: string | null | undefined): string {
  if (!name) return "–";
  return (LABELS as Record<string, string>)[name] ?? name;
}

export interface ProvidersList {
  providers: Provider[];
  loading: boolean;
  /** 501 until S4 lands. */
  unavailable: boolean;
  error: string | null;
  reload: () => void;
  replace: (p: Provider) => void;
}

interface ProvidersState {
  key: string;
  providers: Provider[];
  unavailable: boolean;
  error: string | null;
}

export function useProviders(): ProvidersList {
  const api = useApi();
  const [attempt, setAttempt] = useState(0);
  const key = String(attempt);
  const [state, setState] = useState<ProvidersState>({
    key: "",
    providers: [],
    unavailable: false,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    fetchProviders(api)
      .then((providers) => {
        if (!cancelled) setState({ key, providers, unavailable: false, error: null });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        pushLog(`load providers failed: ${messageOf(e, String(e))}`);
        const unavailable = isNotImplemented(e);
        setState({
          key,
          providers: [],
          unavailable,
          error: unavailable ? null : messageOf(e, "could not load providers"),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [api, key]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  const replace = useCallback(
    (p: Provider) =>
      setState((s) => ({ ...s, providers: s.providers.map((x) => (x.name === p.name ? p : x)) })),
    [],
  );
  const loaded = state.key === key;
  return {
    providers: state.providers,
    loading: !loaded,
    unavailable: loaded && state.unavailable,
    error: loaded ? state.error : null,
    reload,
    replace,
  };
}
