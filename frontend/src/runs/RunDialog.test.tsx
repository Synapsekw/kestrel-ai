import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LibraryModel, ModelGsdEstimate } from "@/api/library";
import {
  CLASS_ID,
  errorBody,
  exampleGeoMap,
  exampleModel,
  exampleProject,
  exampleProviders,
  exampleSource,
  fakeClient,
  MODEL_ID,
  PROJECT_ID,
  runningJob,
  SOURCE_ID,
  type FakeRoute,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { RunDialog } from "./RunDialog";

const MAP_SOURCE = {
  ...exampleSource,
  id: "map-source",
  kind: "map" as const,
  label: "May survey",
  map_id: exampleGeoMap.id,
};

/** The model the dialog picks by default: `exampleModel` unless a test says otherwise. */
function routes(post: FakeRoute[], models: LibraryModel[] = [exampleModel]): FakeRoute[] {
  return [
    ...post,
    { method: "GET", path: /\/sources$/, body: { items: [exampleSource, MAP_SOURCE], next_cursor: null } },
    { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
    { method: "GET", path: /\/library\/models$/, body: { items: models, next_cursor: null } },
    { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
    { method: "GET", path: new RegExp(`/projects/${PROJECT_ID}$`), body: exampleProject },
  ];
}

/** A map run needs a scale (spec 2026-09-23 section 6), so a model that has one is the base case. */
const SCALED_MODEL: LibraryModel = { ...exampleModel, train_gsd_cm: 19 };

const created = {
  runs: [{ run_id: "r1", source_id: SOURCE_ID, kind: "images", job: { ...runningJob, type: "infer" } }],
};

describe("RunDialog", () => {
  it("lists both kinds of source and starts one run per picked source", async () => {
    const list = routes([{ method: "POST", path: /\/runs$/, status: 202, body: created }], [SCALED_MODEL]);
    const { api, requests } = fakeClient(list);
    const onStarted = vi.fn();
    renderWithProviders(
      <RunDialog
        projectId={PROJECT_ID}
        initialSourceIds={[SOURCE_ID]}
        onClose={() => {}}
        onStarted={onStarted}
      />,
      { api },
    );
    expect(await screen.findByText("May survey")).toBeInTheDocument();
    expect(screen.getByText("Map")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Ahmadia Construction Data" })).toBeChecked();
    fireEvent.click(screen.getByRole("checkbox", { name: "May survey" }));
    await screen.findByText(/finds person, bicycle/);

    fireEvent.click(screen.getByRole("button", { name: "Start 2 runs" }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(created));
    const post = requests.find((r) => r.method === "POST");
    expect(post?.body).toEqual({
      source_ids: ["map-source", SOURCE_ID],
      conf: 0.25,
      model_id: MODEL_ID,
      tiling: { enabled: true, tile_size: 1280, overlap: 0.2, nms_iou: 0.5 },
      // Always sent, never omitted: an omitted scale is what let a map be read at its own
      // resolution (spec 2026-09-23 section 5).
      target_gsd_cm: 19,
    });
  });

  it("asks what the unmapped classes become, saves that and retries the same request", async () => {
    const list: FakeRoute[] = routes([
      {
        method: "POST",
        path: /\/runs$/,
        status: 422,
        body: () => {
          list.shift(); // the next POST gets the success below
          return errorBody("unmapped_classes", "3 unmapped", {
            model_id: MODEL_ID,
            unmapped: ["crane", "car", "truck"],
          });
        },
      },
      { method: "POST", path: /\/runs$/, status: 202, body: created },
      {
        method: "PUT",
        path: /\/model-class-maps\//,
        body: { model_id: MODEL_ID, model_classes: [], mapping: {}, unmapped: [] },
      },
    ]);
    const { api, requests } = fakeClient(list);
    const onStarted = vi.fn();
    renderWithProviders(
      <RunDialog
        projectId={PROJECT_ID}
        initialSourceIds={[SOURCE_ID]}
        onClose={() => {}}
        onStarted={onStarted}
      />,
      { api },
    );
    await screen.findByText(/finds person, bicycle/);
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));

    expect(await screen.findByRole("heading", { name: "Match the model's classes" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("crane"), { target: { value: "__new__" } });
    fireEvent.change(screen.getByLabelText("truck"), { target: { value: CLASS_ID(4) } });
    fireEvent.click(screen.getByRole("button", { name: "Save and start" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose what car counts as.");
    fireEvent.click(screen.getByRole("button", { name: "Ignore the rest" }));
    fireEvent.click(screen.getByRole("button", { name: "Save and start" }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(created));
    const put = requests.find((r) => r.method === "PUT");
    expect(put?.body).toEqual({ mapping: { car: null, truck: CLASS_ID(4) }, new_classes: ["crane"] });
    const posts = requests.filter((r) => r.method === "POST");
    expect(posts).toHaveLength(2);
    expect(posts[1].body).toEqual(posts[0].body);
  });

  it("warns when a map's ground size is far from the model's", async () => {
    const { api } = fakeClient(routes([], [{ ...exampleModel, train_gsd_cm: 1 }]));
    renderWithProviders(
      <RunDialog
        projectId={PROJECT_ID}
        initialSourceIds={["map-source"]}
        onClose={() => {}}
        onStarted={() => {}}
      />,
      { api },
    );
    expect(
      await screen.findByText(/May survey is 3.0 cm \/ px; the model was trained at 1.0 cm \/ px/),
    ).toBeInTheDocument();
  });

  it("needs a source", async () => {
    const { api, requests } = fakeClient(routes([]));
    renderWithProviders(<RunDialog projectId={PROJECT_ID} onClose={() => {}} onStarted={() => {}} />, {
      api,
    });
    await screen.findByText("May survey");
    fireEvent.click(screen.getByRole("button", { name: "Start run" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose at least one source.");
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });
});

/**
 * The scale a map run is read at (spec 2026-09-23). The observed failure: `ICVD_V4`, trained on
 * frames flown at 191 m (18.92 cm/px), run against a 2.296 cm/px orthomosaic because nothing made
 * the dialog ask. It found three objects about 1.5 m across on a site whose dump trucks are 8.9 m.
 */
describe("RunDialog: the scale the model was trained at", () => {
  const ESTIMATE: ModelGsdEstimate = {
    train_gsd_cm: 18.92,
    image_gsd_cm: 6.055,
    median_alt_m: 191,
    focal_mm: 18.5,
    sensor_width_mm: 23.456,
    sensor_source: "focal_plane",
    sample_size: 8,
    imgsz: 1280,
    median_object_m: 8.39,
    per_class_m: { excavator: 8.39 },
    plausible: true,
  };
  /** `ICVD_V4` itself: no stored scale, but a dataset in its provenance, so it can be measured. */
  const unmeasured: LibraryModel = {
    ...exampleModel,
    train_gsd_cm: null,
    provenance: { ...exampleModel.provenance, dataset_id: "d1", project_folder: "E:\\Projects\\A" },
  };
  /** An imported model with nothing to measure: `yolo11m-coco`. */
  const nothingToMeasure: LibraryModel = { ...exampleModel, train_gsd_cm: null, provenance: {} };

  function renderMapRun(models: LibraryModel[], estimate?: ModelGsdEstimate) {
    const { api, requests } = fakeClient(
      routes(
        [
          estimate
            ? { method: "GET", path: /\/gsd-estimate$/, body: estimate }
            : {
                method: "GET",
                path: /\/gsd-estimate$/,
                status: 404,
                body: errorBody("not_found", "nothing to measure"),
              },
          {
            method: "PATCH",
            path: /\/library\/models\/[^/]+$/,
            body: (req) => ({ ...models[0], ...(req.body as object) }),
          },
        ],
        models,
      ),
    );
    renderWithProviders(
      <RunDialog
        projectId={PROJECT_ID}
        initialSourceIds={["map-source"]}
        onClose={() => {}}
        onStarted={() => {}}
      />,
      { api },
    );
    return { requests };
  }

  const startButton = () => screen.getByRole("button", { name: /start run/i });

  it("defaults to the model's own training scale", async () => {
    renderMapRun([{ ...exampleModel, train_gsd_cm: 18.92 }]);
    expect(await screen.findByLabelText(/Model trained at/)).toHaveValue(18.92);
    expect(startButton()).toBeEnabled();
  });

  it("offers a derived scale when the model has none, and remembers it once accepted", async () => {
    const { requests } = renderMapRun([unmeasured], ESTIMATE);
    // The evidence a human reads, not a bare number (spec section 3.3).
    expect(await screen.findByText(/trained at about 18.92 cm \/ px/)).toHaveTextContent(
      /flown at about 191 m.*about 8.39 m across/,
    );
    // The offer has resolved and the field is still empty: the run cannot start until it is taken.
    expect(screen.getByLabelText(/Model trained at/)).toHaveValue(null);
    expect(startButton()).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: /use 18.92/i }));
    expect(screen.getByLabelText(/Model trained at/)).toHaveValue(18.92);
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")).toMatchObject({
        url: `/api/v1/library/models/${unmeasured.id}`,
        body: { train_gsd_cm: 18.92 },
      }),
    );
    expect(startButton()).toBeEnabled();
  });

  it("does not offer an implausible estimate", async () => {
    // Section 3.3: 60 m machines mean the altitude was wrong; it is not handed over as a default.
    renderMapRun([unmeasured], { ...ESTIMATE, median_object_m: 60, plausible: false });
    await screen.findByLabelText(/Model trained at/);
    expect(screen.queryByRole("button", { name: /use 18.92/i })).not.toBeInTheDocument();
    expect(startButton()).toBeDisabled();
  });

  it("will not start a map run whose scale is unknown", async () => {
    const { requests } = renderMapRun([nothingToMeasure]);
    expect(await screen.findByLabelText(/Model trained at/)).toHaveValue(null);
    expect(startButton()).toBeDisabled();
    // The button is a hint; the submit handler is the rule. The form submits without it.
    fireEvent.submit(screen.getByLabelText(/Model trained at/).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(/Set the scale this model was trained at/);
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("enables the run once a scale is typed, and only for a positive one", async () => {
    renderMapRun([nothingToMeasure]);
    const field = await screen.findByLabelText(/Model trained at/);
    await userEvent.type(field, "0");
    expect(startButton()).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "-5");
    expect(startButton()).toBeDisabled();
    await userEvent.clear(field);
    await userEvent.type(field, "19");
    expect(startButton()).toBeEnabled();
  });

  it("does not gate a photo-only run, which has no map to rescale", async () => {
    const { api } = fakeClient(routes([], [nothingToMeasure]));
    renderWithProviders(
      <RunDialog
        projectId={PROJECT_ID}
        initialSourceIds={[SOURCE_ID]}
        onClose={() => {}}
        onStarted={() => {}}
      />,
      { api },
    );
    await screen.findByText(/finds person, bicycle/);
    expect(screen.queryByLabelText(/Model trained at/)).not.toBeInTheDocument();
    expect(startButton()).toBeEnabled();
  });
});
