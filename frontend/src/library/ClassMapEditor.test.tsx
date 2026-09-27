import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleCataloguePage, exampleTypes, TYPE_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { ClassMapEditor } from "./ClassMapEditor";

const TYPES: FakeRoute = { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage };
const model = { ...exampleModel, class_map: { person: null } };

describe("ClassMapEditor", () => {
  it("shows the automatic matches and saves only the leftovers", async () => {
    const onSaved = vi.fn();
    const { api, requests } = fakeClient([
      TYPES,
      {
        method: "PUT",
        path: /\/class-map$/,
        body: (r) => ({
          ...model,
          class_map: { ...model.class_map, ...(r.body as { mapping: object }).mapping },
        }),
      },
    ]);
    renderWithProviders(<ClassMapEditor model={model} onSaved={onSaved} />, { api });
    expect(await screen.findByText("by alias dump_truck")).toBeInTheDocument();
    expect(screen.getByLabelText("Type for person")).toHaveValue("__ignore");
    expect(
      screen.getByText("6 classes are not mapped. A run with this model asks for them before it starts."),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Type for car"), { target: { value: TYPE_ID(1) } });
    fireEvent.click(screen.getByRole("button", { name: "Save class mapping" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({
      mapping: { person: null, car: TYPE_ID(1) },
    });
    expect(screen.getByText("Class mapping saved")).toBeInTheDocument();
  });

  it("offers only live types in the pickers", async () => {
    const { api } = fakeClient([TYPES]);
    renderWithProviders(<ClassMapEditor model={model} onSaved={vi.fn()} />, { api });
    const picker = await screen.findByLabelText("Type for car");
    expect(picker).toHaveTextContent(exampleTypes[2].name);
    expect(picker).not.toHaveTextContent("Spalling");
  });

  it("says the mapping cannot be edited while the catalogue is unavailable", async () => {
    const { api } = fakeClient([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "locked"),
      },
    ]);
    renderWithProviders(<ClassMapEditor model={model} onSaved={vi.fn()} />, { api });
    expect(
      await screen.findByText(
        "The catalogue is not available, so the class mapping cannot be edited now. Runs keep using the saved mapping.",
      ),
    ).toBeInTheDocument();
  });
});
