import { beforeEach, describe, it, expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Job } from "@contract/client";
import { useJobsStore } from "@/store/jobs";
import {
  exampleImportedModel,
  exampleLibraryStatus,
  exampleModel,
  exampleTrainedModel,
  exampleUsage,
  fakeClient,
  IMPORTED_MODEL_ID,
  runningJob,
  TRAINED_MODEL_ID,
  type FakeRoute,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { LibraryScreen } from "./LibraryScreen";

const models = [exampleTrainedModel, exampleImportedModel, exampleModel];

function base(overrides: FakeRoute[] = []): FakeRoute[] {
  return [
    ...overrides,
    { method: "GET", path: /\/library\/status$/, body: exampleLibraryStatus },
    { method: "GET", path: /\/library\/models$/, body: { items: models, next_cursor: null } },
    { method: "GET", path: /\/library\/jobs$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/starter-models$/, body: { items: [], next_cursor: null } },
    { method: "GET", path: /\/artifacts\//, raw: true, body: "" },
  ];
}

function renderScreen(routes: FakeRoute[], route = "/library") {
  const fake = fakeClient(routes);
  renderWithProviders(<LibraryScreen />, { api: fake.api, route, path: "/library" });
  return fake;
}

const rowNames = () =>
  within(screen.getByTestId("model-table"))
    .getAllByRole("button", { name: /^Select model / })
    .map((b) => b.textContent);

describe("LibraryScreen", () => {
  beforeEach(() => useJobsStore.setState({ jobs: {}, panelOpen: false }));

  it("lists the library models and filters them by origin and task", async () => {
    const { requests } = renderScreen(base());
    await waitFor(() => expect(rowNames()).toEqual(["ahmadia-v1-n", "client-x-machinery", "yolo11m-coco"]));
    expect(screen.getByText("3 models")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Imported" }));
    expect(rowNames()).toEqual(["client-x-machinery"]);
    fireEvent.click(screen.getByRole("radio", { name: "Starter" }));
    expect(rowNames()).toEqual(["yolo11m-coco"]);
    fireEvent.click(screen.getByRole("radio", { name: "All origins" }));
    fireEvent.click(screen.getByRole("radio", { name: "Rotated boxes" }));
    expect(screen.getByText("No models match these filters.")).toBeInTheDocument();
    expect(requests.some((r) => r.url.startsWith("/api/v1/projects"))).toBe(false);
  });

  it("opens the model named in the URL and shows its provenance", async () => {
    renderScreen(base(), `/library?model=${TRAINED_MODEL_ID}`);
    const detail = await screen.findByTestId("model-detail");
    expect(within(detail).getByTestId("provenance")).toHaveTextContent("Trained in Ahmadia on v1");
    fireEvent.click(screen.getByRole("button", { name: "Select model client-x-machinery" }));
    expect(await screen.findByText(/Supplied by Client X/)).toBeInTheDocument();
  });

  it("imports a model file as a job, shows its progress and selects the model when it succeeds", async () => {
    let polls = 0;
    const queued: Job = {
      ...runningJob,
      id: "j-import",
      project_id: "library",
      type: "library_import",
      params: { name: "client-x-machinery" },
    };
    const importedList = { items: models, next_cursor: null };
    let listCalls = 0;
    const { requests } = renderScreen(
      base([
        { method: "POST", path: /\/library\/models\/import$/, status: 202, body: { job: queued } },
        {
          method: "GET",
          path: /\/library\/jobs$/,
          body: () => {
            polls += 1;
            if (polls === 1) return { items: [], next_cursor: null };
            if (polls === 2) return { items: [queued], next_cursor: null };
            return {
              items: [
                { ...queued, state: "succeeded", progress: 1, result: { model_id: IMPORTED_MODEL_ID } },
              ],
              next_cursor: null,
            };
          },
        },
        {
          method: "GET",
          path: /\/library\/models$/,
          body: () => {
            listCalls += 1;
            return listCalls === 1
              ? { items: [exampleTrainedModel, exampleModel], next_cursor: null }
              : importedList;
          },
        },
      ]),
    );
    await waitFor(() => expect(rowNames()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Import a model file" }));
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "client-x-machinery" } });
    fireEvent.change(screen.getByLabelText("Model file"), { target: { value: "E:/Models/best.pt" } });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "Client X" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
    expect(
      await screen.findByRole("progressbar", { name: /Model import: client-x-machinery/ }),
    ).toBeInTheDocument();
    expect(requests.find((r) => r.method === "POST")?.body).toEqual({
      name: "client-x-machinery",
      weights_path: "E:/Models/best.pt",
      class_aliases: { truck: "dump_truck" },
      supplier: "Client X",
    });
    await waitFor(() => expect(rowNames()).toHaveLength(3), { timeout: 6000 });
    const detail = await screen.findByTestId("model-detail");
    expect(within(detail).getByRole("heading", { name: "client-x-machinery" })).toBeInTheDocument();
    expect(screen.queryByRole("progressbar", { name: /Model import/ })).not.toBeInTheDocument();
  }, 10000);

  it("warns about projects that use a model and deletes only on the second click", async () => {
    const { requests } = renderScreen(
      base([
        { method: "GET", path: /\/usage$/, body: exampleUsage },
        { method: "DELETE", path: /\/library\/models\/[^/]+$/, status: 204 },
      ]),
      `/library?model=${TRAINED_MODEL_ID}`,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete model" }));
    expect(await screen.findByTestId("delete-usage")).toHaveTextContent("Ahmadia");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
    await waitFor(() => expect(rowNames()).toEqual(["client-x-machinery", "yolo11m-coco"]));
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
    expect(screen.queryByTestId("model-detail")).not.toBeInTheDocument();
  });

  it("blocks the screen when the library cannot be opened, without asking for the list", async () => {
    const { requests } = renderScreen([
      {
        method: "GET",
        path: /\/library\/status$/,
        body: { ...exampleLibraryStatus, available: false, error: "library.db is not a database" },
      },
    ]);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The model library could not be opened");
    expect(alert).toHaveTextContent("library.db is not a database");
    expect(alert).toHaveTextContent(exampleLibraryStatus.root);
    expect(requests.map((r) => r.url)).toEqual(["/api/v1/library/status"]);
  });

  it("teaches the first step when the library is empty", async () => {
    renderScreen(
      base([{ method: "GET", path: /\/library\/models$/, body: { items: [], next_cursor: null } }]),
    );
    expect(await screen.findByText("No models in the library yet")).toBeInTheDocument();
  });
});
