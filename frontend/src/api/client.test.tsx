import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

/** Spec section 11: when the backend never answers, the dialog has to say where the log is. */
describe("ApiProvider backend failure dialog", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv("APP_BACKEND_URL", "");
  });

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    vi.restoreAllMocks();
  });

  async function renderFailing(backendInfo: Record<string, unknown>) {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    vi.doMock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue(backendInfo) }));
    vi.doMock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
    vi.doMock("./backend", async () => {
      const real = await vi.importActual<typeof import("./backend")>("./backend");
      return { ...real, waitForHealth: vi.fn().mockRejectedValue(new Error("backend not healthy")) };
    });
    const { ApiProvider } = await import("./client");
    render(
      <ApiProvider>
        <div>app</div>
      </ApiProvider>,
    );
    await waitFor(() => expect(screen.getByRole("alertdialog")).toBeInTheDocument());
  }

  it("shows the sidecar log path reported by backend_info", async () => {
    await renderFailing({
      base_url: "http://127.0.0.1:5555",
      token: "t",
      log_path: "C:\\Users\\D\\AppData\\Roaming\\machinery-app\\logs\\sidecar.log",
    });

    expect(screen.getByText("backend not healthy")).toBeInTheDocument();
    expect(screen.getByText("Log")).toBeInTheDocument();
    expect(
      screen.getByText("C:\\Users\\D\\AppData\\Roaming\\machinery-app\\logs\\sidecar.log"),
    ).toBeInTheDocument();
  });

  it("leaves the log row out when this launch owns no sidecar log", async () => {
    await renderFailing({ base_url: "http://127.0.0.1:5555", token: "t", log_path: null });

    expect(screen.queryByText("Log")).not.toBeInTheDocument();
  });
});
