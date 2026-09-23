import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

function routes(post: FakeRoute[]): FakeRoute[] {
  return [
    ...post,
    { method: "GET", path: /\/sources$/, body: { items: [exampleSource, MAP_SOURCE], next_cursor: null } },
    { method: "GET", path: /\/maps$/, body: { items: [exampleGeoMap] } },
    { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
    { method: "GET", path: /\/providers$/, body: { items: exampleProviders } },
    { method: "GET", path: new RegExp(`/projects/${PROJECT_ID}$`), body: exampleProject },
  ];
}

const created = {
  runs: [{ run_id: "r1", source_id: SOURCE_ID, kind: "images", job: { ...runningJob, type: "infer" } }],
};

describe("RunDialog", () => {
  it("lists both kinds of source and starts one run per picked source", async () => {
    const list = routes([{ method: "POST", path: /\/runs$/, status: 202, body: created }]);
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
    const { api } = fakeClient([
      ...routes([]).filter((r) => !String(r.path).includes("library")),
      {
        method: "GET",
        path: /\/library\/models$/,
        body: { items: [{ ...exampleModel, train_gsd_cm: 1 }], next_cursor: null },
      },
    ]);
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
