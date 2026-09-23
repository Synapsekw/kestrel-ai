import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  exampleGeoMap,
  exampleMapRun,
  exampleModel,
  exampleProviders,
  fakeClient,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { NewRunDialog } from "./NewRunDialog";

describe("NewRunDialog", () => {
  it("prefills the GSD, shows the estimate and starts a local run", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      {
        method: "POST",
        path: /\/map-runs\/estimate$/,
        body: {
          windows: 8900,
          skipped_windows: 2100,
          requests: 6800,
          scale: 1.5,
          cost_per_request: 0,
          estimated_cost: 0,
        },
      },
      {
        method: "POST",
        path: /\/map-runs$/,
        status: 202,
        body: { run: exampleMapRun, job: { ...runningJob, type: "map_detect" } },
      },
    ]);
    const onStarted = vi.fn();
    renderWithProviders(
      <NewRunDialog
        projectId={PROJECT_ID}
        geoMap={exampleGeoMap}
        runs={[{ ...exampleMapRun, model_id: exampleModel.id }]}
        onClose={() => {}}
        onStarted={onStarted}
      />,
      { api },
    );
    expect(await screen.findByLabelText("Model trained at (cm / px)")).toHaveValue(2);
    expect(
      await screen.findByText("6 800 windows to check · 2 100 empty skipped · scaled ×1.5"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Start detection" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const post = requests.find((r) => r.method === "POST" && r.url.endsWith("/map-runs"));
    expect(post?.body).toMatchObject({
      map_id: exampleGeoMap.id,
      kind: "local_model",
      model_id: exampleModel.id,
      target_gsd_cm: 2,
    });
  });
});
