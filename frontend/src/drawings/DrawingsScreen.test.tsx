import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useAddData } from "@/app/addDataStore";
import { pdfDrawing } from "@/mapws/drawings/testFixtures";
import { useChangesStore } from "@/store/changes";
import { errorBody, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { DrawingsScreen } from "./DrawingsScreen";

function renderTab(items: unknown[] = [pdfDrawing], status = 200) {
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/drawings$/,
      status,
      body: status === 200 ? { items } : errorBody("internal", "Database locked"),
    },
    { method: "DELETE", path: new RegExp(`/drawings/${pdfDrawing.id}$`), status: 204 },
  ]);
  renderWithProviders(
    <>
      <DrawingsScreen />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/drawings`, path: "/p/:projectId/*" },
  );
  return { requests };
}

describe("DrawingsScreen", () => {
  beforeEach(() => {
    useAddData.setState({ open: false, tile: null, projectId: PROJECT_ID });
    useChangesStore.setState({ mapWorkspaceRevision: 0, dataRevision: 0 });
  });

  it("lists a drawing and opens it on the map", async () => {
    renderTab();
    expect(await screen.findByText("foundation-plan · p2")).toBeInTheDocument();
    expect(screen.getByText("PDF · page 2 · Not placed")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("row", { name: /foundation-plan/ }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/maps?sel=drawing:${pdfDrawing.id}`);
  });

  it("imports from the empty project", async () => {
    renderTab([]);
    await screen.findByText("No drawings yet");
    fireEvent.click(screen.getAllByRole("button", { name: "Import drawing" })[0]);
    expect(useAddData.getState()).toMatchObject({ open: true, tile: "drawing" });
  });

  it("deletes a drawing after confirmation", async () => {
    const { requests } = renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Delete foundation-plan · p2" }));
    const dialog = screen.getByRole("dialog", { name: "Are you sure?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Yes" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "DELETE" && r.url.includes(pdfDrawing.id))).toBe(true),
    );
  });

  it("shows a failed list and retries", async () => {
    const { requests } = renderTab([], 500);
    expect(await screen.findByText("Database locked")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(requests.filter((r) => r.method === "GET")).toHaveLength(2));
  });
});
