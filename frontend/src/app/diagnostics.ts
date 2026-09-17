import type { Health } from "@contract/client";
import type { BackendInfo } from "@/api/backend";

const MAX_LINES = 200;
const lines: string[] = [];
let backend: BackendInfo | null = null;
let health: Health | null = null;

/** Append one UI log line; only the last 200 are kept. */
export function pushLog(line: string): void {
  lines.push(`${new Date().toISOString()} ${line}`);
  if (lines.length > MAX_LINES) lines.splice(0, lines.length - MAX_LINES);
}

/** Record what the UI knows about the backend, for the diagnostics dump. */
export function setBackendContext(info: BackendInfo | null, lastHealth: Health | null): void {
  backend = info;
  health = lastHealth;
}

/** The text the error boundary copies to the clipboard. */
export function collectDiagnostics(): string {
  return [
    `backend url: ${backend?.baseUrl ?? "unknown"}`,
    `backend mode: ${backend?.mode ?? "unknown"}`,
    `last health: ${health ? JSON.stringify(health) : "none"}`,
    `user agent: ${navigator.userAgent}`,
    "",
    `last ${lines.length} ui log lines:`,
    ...lines,
  ].join("\n");
}
