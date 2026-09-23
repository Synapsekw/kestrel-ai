import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import {
  exampleGeoMap,
  exampleMapRun,
  exampleModel,
  exampleProviders,
  exampleTrainedModel,
  fakeClient,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { NewRunDialog } from "./NewRunDialog";

describe("NewRunDialog", () => {
  it("prefills the GSD, shows the estimate and starts a local run", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
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

  it("lists library models and defaults the GSD to the size the model was trained at", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/models$/,
        body: { items: [{ ...exampleTrainedModel, train_gsd_cm: 4 }, exampleModel], next_cursor: null },
      },
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      { method: "POST", path: /\/map-runs\/estimate$/, status: 500, body: {} },
    ]);
    const { container } = renderWithProviders(
      <NewRunDialog
        projectId={PROJECT_ID}
        geoMap={exampleGeoMap}
        runs={[]}
        onClose={() => {}}
        onStarted={() => {}}
      />,
      { api },
    );
    expect(await screen.findByRole("option", { name: "ahmadia-v1-n" })).toBeInTheDocument();
    expect(container.ownerDocument.querySelector("optgroup")).toHaveAttribute(
      "label",
      "Models in your library",
    );
    await waitFor(() => expect(screen.getByLabelText("Model trained at (cm / px)")).toHaveValue(4));
  });

  it("does not preselect a model whose file is missing and blocks the submit", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/library\/models$/,
        body: { items: [{ ...exampleModel, state: "unavailable" }], next_cursor: null },
      },
      { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
      { method: "POST", path: /\/map-runs\/estimate$/, status: 500, body: {} },
    ]);
    renderWithProviders(
      <NewRunDialog
        projectId={PROJECT_ID}
        geoMap={exampleGeoMap}
        runs={[]}
        onClose={() => {}}
        onStarted={() => {}}
      />,
      { api },
    );
    const missing = await screen.findByRole("option", { name: `${exampleModel.name} (file missing)` });
    expect(missing).toBeDisabled();
    expect(screen.getByLabelText("Model")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "Start detection" }));
    expect(await screen.findByText("Choose a model.")).toBeInTheDocument();
    expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/map-runs"))).toBe(false);
  });
});
