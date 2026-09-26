import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { errorBody, fakeClient, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImportModelForm } from "./ImportModelForm";

const importJob = { ...runningJob, project_id: "library", type: "library_import" as const };

describe("ImportModelForm", () => {
  it("posts name, path, supplier and parsed aliases, then hands over the import job", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/library\/models\/import$/, status: 202, body: { job: importJob } },
    ]);
    const onStarted = vi.fn();
    renderWithProviders(<ImportModelForm onStarted={onStarted} onClose={() => {}} />, { api });
    expect(screen.getByLabelText("Class aliases")).toHaveValue("truck=dump_truck");
    expect(screen.queryByRole("button", { name: "Browse" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "client-x" } });
    fireEvent.change(screen.getByLabelText("Model file"), {
      target: { value: "E:\\Models\\client-x\\best.pt" },
    });
    fireEvent.change(screen.getByLabelText("Supplier"), { target: { value: "Client X" } });
    fireEvent.change(screen.getByLabelText("Class aliases"), {
      target: { value: "truck=dump_truck\ncar=wheel_loader" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith(importJob));
    expect(requests[0]).toMatchObject({
      url: "/api/v1/library/models/import",
      body: {
        name: "client-x",
        weights_path: "E:\\Models\\client-x\\best.pt",
        class_aliases: { truck: "dump_truck", car: "wheel_loader" },
        supplier: "Client X",
      },
    });
  });

  it("sends no supplier when the field is blank, and shows the envelope message on refusal", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/library\/models\/import$/,
        status: 404,
        body: errorBody("not_found", "model file not found"),
      },
    ]);
    renderWithProviders(<ImportModelForm onStarted={() => {}} onClose={() => {}} />, { api });
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Model file"), { target: { value: "E:\\nope.pt" } });
    fireEvent.click(screen.getByRole("button", { name: "Add to library" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("model file not found"));
    expect(requests[0].body).toMatchObject({ supplier: null });
  });
});
