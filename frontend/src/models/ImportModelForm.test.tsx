import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { ImportModelForm } from "./ImportModelForm";

describe("ImportModelForm", () => {
  it("posts name, path and parsed aliases, then reports the model", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/models\/import$/, status: 201, body: exampleModel },
    ]);
    const onImported = vi.fn();
    renderWithProviders(
      <ImportModelForm projectId={PROJECT_ID} onImported={onImported} onClose={() => {}} />,
      { api },
    );
    expect(screen.getByLabelText("Class aliases")).toHaveValue("truck=dump_truck");
    expect(screen.queryByRole("button", { name: "Browse" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "yolo11m-coco" } });
    fireEvent.change(screen.getByLabelText("Weights path"), {
      target: { value: "E:\\Dev\\Yolo\\models\\yolo11m.pt" },
    });
    fireEvent.change(screen.getByLabelText("Class aliases"), {
      target: { value: "truck=dump_truck\ncar=wheel_loader" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(onImported).toHaveBeenCalledWith(exampleModel));
    expect(requests[0].body).toEqual({
      name: "yolo11m-coco",
      weights_path: "E:\\Dev\\Yolo\\models\\yolo11m.pt",
      class_aliases: { truck: "dump_truck", car: "wheel_loader" },
    });
  });

  it("shows the envelope message when the path is rejected", async () => {
    const { api } = fakeClient([
      {
        method: "POST",
        path: /\/models\/import$/,
        status: 404,
        body: errorBody("not_found", "weights file not found"),
      },
    ]);
    renderWithProviders(<ImportModelForm projectId={PROJECT_ID} onImported={() => {}} onClose={() => {}} />, {
      api,
    });
    fireEvent.change(screen.getByLabelText("Model name"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("Weights path"), { target: { value: "E:\\nope.pt" } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("weights file not found"));
  });
});
