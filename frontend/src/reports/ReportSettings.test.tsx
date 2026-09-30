import { useMemo, useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ApiClient } from "@contract/client";
import { ApiContext, type ApiContextValue } from "@/api/client";
import type { ReportConfig } from "@/api/reports";
import { errorBody, exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LOGO_ASSET_ID, reportConfig } from "@/test/reportBuilderFixtures";
import { ReportSettings } from "./ReportSettings";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "C:\\logos\\client.png") }));

function Provider({ api, mode, children }: { api: ApiClient; mode: "mock" | "tauri"; children: ReactNode }) {
  const value = useMemo<ApiContextValue>(
    () => ({
      client: api,
      info: { baseUrl: "http://fake", token: "t", mode, logPath: null },
      health: { status: "ok", version: "test", pid: 1, started_at: "2026-09-17T00:00:00Z" },
    }),
    [api, mode],
  );
  return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
}

function setup(opts: { mode?: "mock" | "tauri"; logoStatus?: number } = {}) {
  const onEdit = vi.fn();
  let latest: ReportConfig = reportConfig();
  function Harness() {
    const [config, setConfig] = useState(reportConfig());
    return (
      <ReportSettings
        projectId={PROJECT_ID}
        config={config}
        matchCount={38}
        onEdit={(change) => {
          setConfig((c) => {
            latest = change(c);
            return latest;
          });
          onEdit(change);
        }}
      />
    );
  }
  const logoStatus = opts.logoStatus ?? 201;
  const { api, requests } = fakeClient([
    {
      method: "POST",
      path: /\/report-assets$/,
      status: logoStatus,
      body:
        logoStatus === 201
          ? {
              id: LOGO_ASSET_ID,
              kind: "logo",
              path: "reports/assets/logo-1a2b3c4d.png",
              sha256: "c".repeat(64),
              width: 1200,
              height: 400,
            }
          : errorBody("asset_invalid", "The logo is not a PNG, JPEG or WebP image", {
              reason: "not_an_image",
            }),
    },
    { method: "GET", path: /\/projects\/[^/]+\/data$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  ]);
  render(
    <Provider api={api} mode={opts.mode ?? "mock"}>
      <MemoryRouter>
        <Harness />
      </MemoryRouter>
    </Provider>,
  );
  return { onEdit, requests, latest: () => latest };
}

describe("ReportSettings", () => {
  it("edits the cover and the paper", () => {
    const { latest } = setup();
    const cover = screen.getByRole("region", { name: "Cover" });
    fireEvent.change(within(cover).getByLabelText("Title"), { target: { value: "North yard" } });
    fireEvent.change(within(cover).getByLabelText("Client"), { target: { value: "Port authority" } });
    expect(latest().cover).toMatchObject({ title: "North yard", client: "Port authority" });
    fireEvent.change(within(cover).getByLabelText("Report date"), { target: { value: "2026-09-30" } });
    expect(latest().cover.report_date).toBe("2026-09-30");
    fireEvent.change(within(cover).getByLabelText("Report date"), { target: { value: "" } });
    expect(latest().cover.report_date).toBeNull();
    fireEvent.click(
      within(screen.getByRole("region", { name: "Paper" })).getByRole("radio", { name: "Letter" }),
    );
    expect(latest().paper.size).toBe("Letter");
  });

  it("hosts the filters in their own region", () => {
    setup();
    expect(within(screen.getByRole("region", { name: "Filters" })).getByRole("status")).toHaveTextContent(
      "38 findings match",
    );
  });

  it("adds a logo from a path outside the desktop shell", async () => {
    const { requests, latest } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Logo file path" }), {
      target: { value: "C:\\logos\\client.png" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add logo" }));
    await screen.findByText("Logo added · 1200 × 400 px");
    expect(requests.find((r) => r.url.endsWith("/report-assets"))?.body).toEqual({
      path: "C:\\logos\\client.png",
    });
    expect(latest().cover.logo_asset_id).toBe(LOGO_ASSET_ID);
    fireEvent.click(screen.getByRole("button", { name: "Remove logo" }));
    expect(latest().cover.logo_asset_id).toBeNull();
  });

  it("picks a logo with the file dialog in the desktop shell", async () => {
    const { requests } = setup({ mode: "tauri" });
    fireEvent.click(screen.getByRole("button", { name: "Choose logo" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/report-assets"))?.body).toEqual({
        path: "C:\\logos\\client.png",
      }),
    );
    expect(await screen.findByRole("button", { name: "Replace logo" })).toBeInTheDocument();
  });

  it("a refused logo says why and keeps the cover as it was", async () => {
    const { latest } = setup({ logoStatus: 422 });
    fireEvent.change(screen.getByRole("textbox", { name: "Logo file path" }), {
      target: { value: "C:\\a.svg" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add logo" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The logo is not a PNG, JPEG or WebP image");
    expect(latest().cover.logo_asset_id).toBeNull();
  });
});
