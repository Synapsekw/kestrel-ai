import type { ApiClient, Health } from "@contract/client";

export type BackendMode = "tauri" | "env" | "mock";

export interface BackendInfo {
  baseUrl: string;
  token: string;
  mode: BackendMode;
}

/**
 * Where the backend lives: the Tauri sidecar when running inside the shell,
 * an externally started backend when `APP_BACKEND_URL` is set, else the mock server.
 */
export async function resolveBackend(): Promise<BackendInfo> {
  if ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<{ base_url: string; token: string }>("backend_info");
    return { baseUrl: info.base_url, token: info.token, mode: "tauri" };
  }
  const url = import.meta.env.APP_BACKEND_URL;
  if (url) return { baseUrl: url, token: import.meta.env.APP_BACKEND_TOKEN ?? "", mode: "env" };
  return { baseUrl: "http://127.0.0.1:4010", token: "mock", mode: "mock" };
}

/** Poll `GET /api/v1/health` until it answers or the timeout elapses. */
export async function waitForHealth(
  client: ApiClient,
  timeoutMs = 60_000,
  intervalMs = 500,
): Promise<Health> {
  const t0 = Date.now();
  let lastError = "";
  while (Date.now() - t0 < timeoutMs) {
    try {
      const { data, error } = await client.GET("/api/v1/health");
      if (data) return data;
      lastError = JSON.stringify(error);
    } catch (e) {
      lastError = String(e);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(`backend not healthy after ${timeoutMs} ms: ${lastError}`);
}
