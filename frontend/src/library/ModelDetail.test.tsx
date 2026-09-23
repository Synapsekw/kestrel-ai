import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleImportedModel,
  exampleModel,
  exampleTrainedModel,
  exampleUsage,
  fakeClient,
  runningJob,
  TRAINED_MODEL_ID,
} from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ModelDetail } from "./ModelDetail";

const noop = () => {};

function renderDetail(
  model = exampleTrainedModel,
  routes: Parameters<typeof fakeClient>[0] = [],
  handlers: Partial<{
    onChanged: (m: typeof model) => void;
    onDeleted: (id: string) => void;
    onJobStarted: (j: typeof runningJob) => void;
  }> = {},
) {
  const fake = fakeClient([
    { method: "GET", path: /\/artifacts\//, raw: true, body: "" },
    ...routes,
  ]);
  renderWithProviders(
    <ModelDetail
      model={model}
      onChanged={handlers.onChanged ?? noop}
      onDeleted={handlers.onDeleted ?? noop}
      onJobStarted={handlers.onJobStarted ?? noop}
    />,
    { api: fake.api },
  );
  return fake;
}

describe("ModelDetail", () => {
  it("shows where a trained model came from", () => {
    renderDetail();
    expect(screen.getByTestId("provenance")).toHaveTextContent("Trained in Ahmadia on v1");
    expect(screen.getByTestId("provenance")).toHaveTextContent("starting from yolo11m-coco");
  });

  it("shows the file and supplier of an imported model", () => {
    renderDetail(exampleImportedModel);
    expect(screen.getByTestId("provenance")).toHaveTextContent("Imported from E:\\Models\\client-x\\best.pt");
    expect(screen.getByTestId("provenance")).toHaveTextContent("Supplied by Client X");
  });

  it("saves only the changed fields with PATCH", async () => {
    const onChanged = vi.fn();
    const { requests } = renderDetail(
      exampleTrainedModel,
      [
        {
          method: "PATCH",
          path: /\/library\/models\/[^/]+$/,
          body: { ...exampleTrainedModel, notes: "Weak on small trucks.", supplier: "Ops team" },
        },
      ],
      { onChanged },
    );
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Weak on small trucks." } });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "Ops team" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    const patch = requests.find((r) => r.method === "PATCH");
    expect(patch).toMatchObject({
      url: `/api/v1/library/models/${TRAINED_MODEL_ID}`,
      body: { notes: "Weak on small trucks.", supplier: "Ops team" },
    });
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("edits the class aliases", async () => {
    const { requests } = renderDetail(exampleModel, [
      { method: "PATCH", path: /\/library\/models\/[^/]+$/, body: exampleModel },
    ]);
    expect(screen.getByLabelText("Class aliases")).toHaveValue("truck=dump_truck");
    fireEvent.change(screen.getByLabelText("Class aliases"), {
      target: { value: "truck=dump_truck\ncar=wheel_loader" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      class_aliases: { truck: "dump_truck", car: "wheel_loader" },
    });
  });

  it("names the projects that use a model and deletes only on the second click", async () => {
    const onDeleted = vi.fn();
    const { requests } = renderDetail(
      exampleTrainedModel,
      [
        { method: "GET", path: /\/usage$/, body: exampleUsage },
        { method: "DELETE", path: /\/library\/models\/[^/]+$/, status: 204 },
      ],
      { onDeleted },
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete model" }));
    const warning = await screen.findByTestId("delete-usage");
    expect(warning).toHaveTextContent("Ahmadia");
    expect(warning).toHaveTextContent("Past results stay readable");
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete anyway" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith(TRAINED_MODEL_ID));
    expect(requests.filter((r) => r.method === "DELETE")).toHaveLength(1);
  });

  it("asks once more when no known project uses the model, and can be cancelled", async () => {
    const { requests } = renderDetail(exampleTrainedModel, [
      { method: "GET", path: /\/usage$/, body: { projects: [] } },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Delete model" }));
    expect(await screen.findByRole("button", { name: "Delete permanently" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Delete permanently" })).not.toBeInTheDocument();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);
  });

  it("hands an export job to the caller", async () => {
    const onJobStarted = vi.fn();
    const job = { ...runningJob, project_id: "library", type: "library_export" as const };
    renderDetail(exampleTrainedModel, [{ method: "POST", path: /\/export$/, status: 202, body: { job } }], {
      onJobStarted,
    });
    fireEvent.click(screen.getByRole("button", { name: "Export ONNX" }));
    await waitFor(() => expect(onJobStarted).toHaveBeenCalledWith(job));
  });

  it("warns when the weights file is missing", () => {
    renderDetail({ ...exampleTrainedModel, state: "unavailable" });
    expect(screen.getByText(/weights file is missing/)).toBeInTheDocument();
  });

  it("shows the reason when the usage cannot be checked", async () => {
    renderDetail(exampleTrainedModel, [
      { method: "GET", path: /\/usage$/, status: 503, body: errorBody("library_unavailable", "library is down") },
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Delete model" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("library is down");
  });
});
