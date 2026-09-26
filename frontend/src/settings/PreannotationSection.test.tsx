import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { exampleModel, exampleProject, fakeClient, errorBody } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { PreannotationSection } from "./PreannotationSection";

describe("PreannotationSection", () => {
  it("lists models and patches the project on change", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/models$/, body: { items: [exampleModel], next_cursor: null } },
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
    expect(requests[0].url).toBe("/api/v1/library/models?limit=1000");
    expect(requests[1]).toMatchObject({ method: "PATCH", body: { preannotation_model_id: null } });
    expect(screen.getByRole("group", { name: "Models in your library" })).toBeInTheDocument();
  });

  it("keeps the setting when the library cannot be opened", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/library\/models$/,
        status: 503,
        body: errorBody("library_unavailable", "library down"),
      },
    ]);
    renderWithProviders(<PreannotationSection project={exampleProject} onSaved={() => {}} />, { api });
    await waitFor(() =>
      expect(screen.getByRole("note")).toHaveTextContent("The model library could not be opened"),
    );
    expect(screen.getByLabelText("Pre-annotation model")).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
