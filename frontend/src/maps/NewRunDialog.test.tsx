import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Model } from "@contract/client";
import type { ModelGsdEstimate } from "@/api/models";
import {
  errorBody,
  exampleGeoMap,
  exampleMapRun,
  exampleModel,
  exampleProviders,
  fakeClient,
  type FakeRoute,
  PROJECT_ID,
  runningJob,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { NewRunDialog } from "./NewRunDialog";

/** Renders the dialog behind a fake API: a model list, providers, and (optionally) a gsd-estimate
 * and patch route. Returns the recorded requests so a test can inspect what the dialog sent. */
function renderDialog(opts: { models?: Model[]; estimate?: Partial<ModelGsdEstimate> } = {}) {
  const models = opts.models ?? [exampleModel];
  const routes: FakeRoute[] = [
    { method: "GET", path: /\/models$/, body: { items: models, next_cursor: null } },
    { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
    opts.estimate
      ? { method: "GET", path: /\/gsd-estimate$/, body: opts.estimate }
      : { method: "GET", path: /\/gsd-estimate$/, status: 404, body: errorBody("not_found", "no dataset") },
    {
      method: "PATCH",
      path: /\/models\/[^/]+$/,
      body: (req) => ({ ...models[0], ...(req.body as object) }),
    },
  ];
  const { api, requests } = fakeClient(routes);
  const onStarted = vi.fn();
  renderWithProviders(
    <NewRunDialog
      projectId={PROJECT_ID}
      geoMap={exampleGeoMap}
      runs={[]}
      onClose={() => {}}
      onStarted={onStarted}
    />,
    { api },
  );
  return { requests, onStarted };
}

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

  it("defaults the scale to the model's training GSD", async () => {
    renderDialog({ models: [{ ...exampleModel, id: "m1", train_gsd_cm: 18.92 }] });
    expect(await screen.findByLabelText(/Model trained at/)).toHaveValue(18.92);
  });

  it("offers a derived scale when the model has none, and stores it once accepted", async () => {
    const { requests } = renderDialog({
      models: [{ ...exampleModel, id: "m1", train_gsd_cm: null, dataset_id: "d1" }],
      estimate: {
        train_gsd_cm: 18.92,
        median_alt_m: 191,
        median_object_m: 8.39,
        plausible: true,
        sensor_source: "focal_plane",
      },
    });
    await userEvent.click(await screen.findByRole("button", { name: /use 18.92/i }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")).toMatchObject({
        url: `/api/v1/projects/${PROJECT_ID}/models/m1`,
        body: { train_gsd_cm: 18.92 },
      }),
    );
    expect(screen.getByLabelText(/Model trained at/)).toHaveValue(18.92);
  });

  it("will not start a run whose scale is unknown", async () => {
    renderDialog({ models: [{ ...exampleModel, id: "m1", train_gsd_cm: null, dataset_id: null }] });
    expect(await screen.findByRole("button", { name: /start detection/i })).toBeDisabled();
  });

  it("enables Start once a scale is typed", async () => {
    renderDialog({ models: [{ ...exampleModel, id: "m1", train_gsd_cm: null, dataset_id: null }] });
    await userEvent.type(await screen.findByLabelText(/Model trained at/), "19");
    expect(screen.getByRole("button", { name: /start detection/i })).toBeEnabled();
  });

  it("keeps Start disabled for a zero scale", async () => {
    renderDialog({ models: [{ ...exampleModel, id: "m1", train_gsd_cm: null, dataset_id: null }] });
    await userEvent.type(await screen.findByLabelText(/Model trained at/), "0");
    expect(screen.getByRole("button", { name: /start detection/i })).toBeDisabled();
  });

  it("keeps Start disabled for a negative scale", async () => {
    renderDialog({ models: [{ ...exampleModel, id: "m1", train_gsd_cm: null, dataset_id: null }] });
    await userEvent.type(await screen.findByLabelText(/Model trained at/), "-5");
    expect(screen.getByRole("button", { name: /start detection/i })).toBeDisabled();
  });
});
