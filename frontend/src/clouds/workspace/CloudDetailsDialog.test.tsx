import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { CloudDetailsDialog } from "./CloudDetailsDialog";

const view = (bytes: number, id: string) => ({
  subject_kind: "finding",
  subject_id: id,
  pose: { position: [0, 0, 10], target: [0, 0, 0], up: [0, 0, 1], fov_deg: 50 },
  render: {
    colour_mode: "rgb",
    point_budget: 3_000_000,
    point_size: 1,
    edl: true,
    clip_box: null,
    complete: true,
  },
  anchor_normal: null,
  sha256: "ab".repeat(32),
  bytes,
  width: 1600,
  height: 1000,
  captured_at: "2026-09-27T10:00:00Z",
  stale: false,
});

function show(routes: Parameters<typeof fakeClient>[0]) {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(
    <CloudDetailsDialog
      projectId={PROJECT_ID}
      cloud={exampleCloud}
      maps={[]}
      exportJobId={null}
      onExportStarted={vi.fn()}
      onChanged={vi.fn()}
      onDeleted={vi.fn()}
      onClose={vi.fn()}
    />,
    { api },
  );
  return requests;
}

describe("CloudDetailsDialog (spec C12, §13)", () => {
  it("wraps S1's details and states the report views' count and size", async () => {
    show([
      {
        method: "GET",
        path: new RegExp(`/pointclouds/${CLOUD_ID}/views$`),
        body: { items: [view(2_000_000, "f1"), view(1_500_000, "f2")] },
      },
    ]);
    expect(screen.getByRole("dialog", { name: exampleCloud.name })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export LAZ" })).toBeInTheDocument();
    expect(await screen.findByTestId("cloud-report-views")).toHaveTextContent("Report views: 2 · 3.5 MB");
  });

  it("hides the report-views line on 501", async () => {
    const requests = show([
      {
        method: "GET",
        path: /\/views$/,
        status: 501,
        body: { error: { code: "not_implemented", message: "not implemented yet", details: {} } },
      },
    ]);
    await waitFor(() => expect(requests.some((r) => r.url.endsWith("/views"))).toBe(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("cloud-report-views")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
