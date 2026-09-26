import { describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { exampleCataloguePage, exampleTypes } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { CatalogueScreen } from "./CatalogueScreen";

const LIST: FakeRoute = {
  method: "GET",
  path: /\/catalogue\/types$/,
  body: { ...exampleCataloguePage, needs_classification: false },
};

function renderCatalogue(routes: FakeRoute[], route = "/catalogue") {
  const { api, requests } = fakeClient(routes);
  renderWithProviders(<CatalogueScreen tab="types" />, { api, route, path: "/catalogue" });
  return requests;
}

describe("CatalogueScreen, types", () => {
  it("lists the live types with group, default severity and hotkey", async () => {
    renderCatalogue([LIST]);
    const row = await screen.findByRole("row", { name: /Crack/ });
    expect(row).toHaveTextContent("Concrete defects");
    expect(row).toHaveTextContent("Moderate");
    expect(within(row).getByText("C")).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Spalling/ })).not.toBeInTheDocument();
  });

  it("filters by search, kind and archived", async () => {
    renderCatalogue([LIST]);
    await screen.findByRole("row", { name: /Crack/ });
    fireEvent.change(screen.getByLabelText("Search types"), { target: { value: "dump_truck" } });
    expect(screen.getByRole("row", { name: /Dump truck/ })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Excavator/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search types"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("radio", { name: "Defects" }));
    expect(screen.queryByRole("row", { name: /Excavator/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Show archived"));
    expect(screen.getByRole("row", { name: /Spalling/ })).toHaveTextContent("Archived");
  });

  it("opens a row in the editor and saves only the change", async () => {
    const requests = renderCatalogue([
      LIST,
      {
        method: "PATCH",
        path: /\/catalogue\/types\/[^/]+$/,
        body: { ...exampleTypes[2], name: "Hairline crack" },
      },
    ]);
    fireEvent.click(await screen.findByRole("row", { name: /Crack/ }));
    expect(screen.getByRole("heading", { name: "Crack" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Hairline crack" } });
    fireEvent.click(screen.getByRole("button", { name: "Save type" }));
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ name: "Hairline crack" }),
    );
    expect(await screen.findByRole("heading", { name: "Hairline crack" })).toBeInTheDocument();
  });

  it("opens the new-type editor from ?type=new", async () => {
    renderCatalogue([LIST], "/catalogue?type=new");
    expect(await screen.findByRole("heading", { name: "New type" })).toBeInTheDocument();
  });

  it("an unknown ?type= says so and keeps the list", async () => {
    renderCatalogue([LIST], "/catalogue?type=gone");
    expect(await screen.findByText("That type is not in the catalogue")).toBeInTheDocument();
    expect(screen.getByRole("row", { name: /Crack/ })).toBeInTheDocument();
  });

  it("blocks with the reason when the catalogue is unavailable", async () => {
    renderCatalogue([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "locked"),
      },
    ]);
    expect(await screen.findByText("The catalogue could not be opened")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy folder path" })).not.toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Crack/ })).not.toBeInTheDocument();
  });

  it("blocks with the reason and the folder when the catalogue is unavailable", async () => {
    renderCatalogue([
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "locked", { folder: "C:\\lib" }),
      },
    ]);
    expect(await screen.findByText("The catalogue could not be opened")).toBeInTheDocument();
    expect(screen.getByText("C:\\lib")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy folder path" })).toBeInTheDocument();
    expect(screen.queryByRole("row", { name: /Crack/ })).not.toBeInTheDocument();
  });
});
