import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const conf = JSON.parse(readFileSync(resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8")) as {
  app: { security: { csp: string } };
};
const directive = (name: string): string[] =>
  conf.app.security.csp
    .split(";")
    .map((d) => d.trim().split(/\s+/))
    .find((d) => d[0] === name)
    ?.slice(1) ?? [];

describe("packaged app CSP", () => {
  it("lets Tauri's IPC through, so invoke() does not fall back to postMessage with a console error", () => {
    expect(directive("connect-src")).toEqual(expect.arrayContaining(["ipc:", "http://ipc.localhost"]));
  });

  it("still talks to nothing but the app itself and the local sidecar", () => {
    const allowed = ["'self'", "ipc:", "http://ipc.localhost", "http://127.0.0.1:*", "ws://127.0.0.1:*"];
    expect(directive("connect-src").filter((s) => !allowed.includes(s))).toEqual([]);
  });

  it("lets potree-core start its inline blob workers (spec §13)", () => {
    expect(directive("worker-src")).toEqual(["blob:"]);
  });

  it("changes nothing else: default-src, script-src and connect-src stay as they were", () => {
    expect(directive("default-src")).toEqual(["'self'"]);
    expect(directive("script-src")).toEqual([]);
    expect(directive("connect-src")).toEqual([
      "'self'",
      "ipc:",
      "http://ipc.localhost",
      "http://127.0.0.1:*",
      "ws://127.0.0.1:*",
    ]);
    expect(conf.app.security.csp).not.toMatch(/unsafe-eval|wasm-unsafe-eval/);
  });
});
