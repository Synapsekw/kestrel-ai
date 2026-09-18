import type { ApiClient, Provider, ProviderName, components } from "@contract/client";
import { unwrap } from "./errors";

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
