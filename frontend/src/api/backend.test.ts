import { describe, it, expect, vi, beforeEach } from "vitest";

describe("resolveBackend", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  });

  it("falls back to the mock server", async () => {
    vi.stubEnv("APP_BACKEND_URL", "");
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({
      baseUrl: "http://127.0.0.1:4010",
      token: "mock",
      mode: "mock",
      logPath: null,
    });
  });

  it("uses APP_BACKEND_URL when set", async () => {
    vi.stubEnv("APP_BACKEND_URL", "http://127.0.0.1:8765");
    vi.stubEnv("APP_BACKEND_TOKEN", "abc");
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({
      baseUrl: "http://127.0.0.1:8765",
      token: "abc",
      mode: "env",
      logPath: null,
    });
  });

  it("asks tauri when running inside the shell", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn().mockResolvedValue({
        base_url: "http://127.0.0.1:5555",
        token: "t",
        log_path: "C:\logs\sidecar.log",
      }),
    }));
    const { resolveBackend } = await import("./backend");
    expect(await resolveBackend()).toEqual({
      baseUrl: "http://127.0.0.1:5555",
      token: "t",
      mode: "tauri",
      logPath: "C:\logs\sidecar.log",
    });
  });

  it("reports no log path when the shell attached to an external backend", async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.doMock("@tauri-apps/api/core", () => ({
      invoke: vi.fn().mockResolvedValue({ base_url: "http://127.0.0.1:8765", token: "t", log_path: null }),
    }));
    const { resolveBackend } = await import("./backend");
    expect((await resolveBackend()).logPath).toBeNull();
  });
});

describe("terminationMessage", () => {
  it("names the exit code when the sidecar reports one", async () => {
    const { terminationMessage } = await import("./backend");
    expect(terminationMessage({ code: 3 })).toBe("Backend process exited (code 3)");
  });

  it("falls back when the sidecar reports no code", async () => {
    const { terminationMessage } = await import("./backend");
    expect(terminationMessage({ code: null })).toBe("Backend process exited");
    expect(terminationMessage(undefined)).toBe("Backend process exited");
  });
});
