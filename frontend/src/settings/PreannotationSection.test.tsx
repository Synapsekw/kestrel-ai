import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleModel, exampleProject, fakeClient, errorBody } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { PreannotationSection } from "./PreannotationSection";

describe("PreannotationSection", () => {
  it("lists models and patches the project on change", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/models$/, body: { items: [exampleModel], next_cursor: null } },
      {
        method: "PATCH",
        path: /\/projects\/[^/]+$/,
        body: { ...exampleProject, preannotation_model_id: null },
      },
    ]);
    const onSaved = vi.fn();
    renderWithProviders(<PreannotationSection project={exampleProject} onSaved={onSaved} />, { api });
    const select = await screen.findByLabelText("Pre-annotation model");
    await waitFor(() => expect(select).toHaveValue(exampleModel.id));
    fireEvent.change(select, { target: { value: "" } });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests[1]).toMatchObject({ method: "PATCH", body: { preannotation_model_id: null } });
  });

  it("tolerates 501 from the registry", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/models$/, status: 501, body: errorBody("not_implemented", "models later") },
    ]);
    renderWithProviders(<PreannotationSection project={exampleProject} onSaved={() => {}} />, { api });
    await waitFor(() =>
      expect(screen.getByRole("note")).toHaveTextContent("The model registry is not available yet"),
    );
    expect(screen.getByLabelText("Pre-annotation model")).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
