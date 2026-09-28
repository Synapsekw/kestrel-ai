import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { errorBody, fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import {
  CLOUD_DATA_ID,
  CLOUD_MEASUREMENT,
  MAP_MEASUREMENT,
  MAP_MEASUREMENT_ID,
  UNKNOWN_MEASUREMENT,
  VOLUME_MEASUREMENT,
  VOLUME_MEASUREMENT_ID,
  measurementItem,
} from "@/test/measurementFixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { MeasurementsScreen } from "./MeasurementsScreen";

const ROWS = [MAP_MEASUREMENT, CLOUD_MEASUREMENT, VOLUME_MEASUREMENT, UNKNOWN_MEASUREMENT];

function renderTab(search = "", items: unknown[] = ROWS, status = 200) {
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/projects\/[^/]+\/measurements$/,
      status,
      body: status === 200 ? { items, next_cursor: null } : errorBody("internal", "Database locked"),
    },
  ]);
  // Mounted under a splat so a row's navigation keeps the probe on screen.
  renderWithProviders(
    <>
      <MeasurementsScreen />
      <LocationProbe />
    </>,
    {
      api,
      route: `/p/${PROJECT_ID}/measurements${search}`,
      path: "/p/:projectId/*",
    },
  );
  return requests;
}

const listQueries = (requests: RecordedRequest[]) =>
  requests
    .filter((r) => /\/measurements\?/.test(r.url))
    .map((r) => new URL(r.url, "http://fake").searchParams);
const rowOf = (text: string) => screen.getByText(text).closest('[role="row"]') as HTMLElement;
const location = () => screen.getByTestId("location");

describe("MeasurementsScreen", () => {
  beforeEach(() => useChangesStore.setState({ measurementsRevision: 0, openProjectId: null }));

  it("shows name, kind, headline and status per row", async () => {
    renderTab();
    await screen.findByText("Fence line");
    expect(screen.getByRole("heading", { level: 1, name: "Measurements" })).toBeInTheDocument();
    const map = rowOf("Fence line");
    expect(within(map).getByText("Map · Distance")).toBeInTheDocument();
    expect(within(map).getByText("12.5 m")).toBeInTheDocument();
    expect(within(map).getByText("Ready")).toBeInTheDocument();
    const volume = rowOf("Pile 1");
    expect(within(volume).getByText("Volume")).toBeInTheDocument();
    expect(within(volume).getByText("1 234.5 m³")).toBeInTheDocument();
    expect(within(volume).getByText("Stale")).toBeInTheDocument();
  });

  it("renders a sub-kind it does not know, with no headline, as a normal row", async () => {
    renderTab();
    const row = await screen.findByText("Slope A").then((el) => el.closest('[role="row"]') as HTMLElement);
    expect(within(row).getByText("Point cloud · Slope angle")).toBeInTheDocument();
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("Computing")).toBeInTheDocument();
  });

  it("opens a map row in the map workspace", async () => {
    renderTab();
    fireEvent.click(await screen.findByText("Fence line"));
    await waitFor(() =>
      expect(location()).toHaveTextContent(`/p/${PROJECT_ID}/maps?sel=measurement:${MAP_MEASUREMENT_ID}`),
    );
  });

  it("opens a cloud row in its cloud", async () => {
    renderTab();
    fireEvent.click(await screen.findByText("Mast height"));
    await waitFor(() => expect(location()).toHaveTextContent(`/p/${PROJECT_ID}/clouds/${CLOUD_DATA_ID}`));
  });

  it("opens a volume row in the volume view", async () => {
    renderTab();
    fireEvent.click(await screen.findByText("Pile 1"));
    await waitFor(() =>
      expect(location()).toHaveTextContent(`/p/${PROJECT_ID}/measurements/volumes/${VOLUME_MEASUREMENT_ID}`),
    );
  });

  it("does not navigate for a kind it does not know", async () => {
    renderTab("", [
      measurementItem(7, {
        kind: "survey_line",
        sub_kind: null,
        name: "Odd one",
      }),
    ]);
    fireEvent.click(await screen.findByText("Odd one"));
    expect(within(rowOf("Odd one")).getByText("Survey line")).toBeInTheDocument();
    expect(location()).toHaveTextContent(`/p/${PROJECT_ID}/measurements`);
    expect(location().textContent).toBe(`/p/${PROJECT_ID}/measurements`);
  });

  it("filters by kind, then by type, through the URL", async () => {
    const requests = renderTab();
    await screen.findByText("Fence line");
    expect(screen.queryByRole("combobox", { name: "Measurement type" })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Maps" }));
    await waitFor(() => expect(location()).toHaveTextContent("kind=map"));
    await waitFor(() => expect(listQueries(requests).at(-1)!.get("kind")).toBe("map"));
    fireEvent.change(screen.getByRole("combobox", { name: "Measurement type" }), {
      target: { value: "area" },
    });
    await waitFor(() => expect(location()).toHaveTextContent("kind=map&sub_kind=area"));
    await waitFor(() => expect(listQueries(requests).at(-1)!.get("sub_kind")).toBe("area"));
    fireEvent.click(screen.getByRole("radio", { name: "Point clouds" }));
    await waitFor(() => expect(location().textContent).toBe(`/p/${PROJECT_ID}/measurements?kind=cloud`));
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    await waitFor(() => expect(location().textContent).toBe(`/p/${PROJECT_ID}/measurements`));
  });

  it("teaches where measurements come from when there are none", async () => {
    renderTab("", []);
    expect(await screen.findByText("No measurements yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open maps" })).toBeInTheDocument();
  });

  it("offers to clear filters when a filter matches nothing", async () => {
    renderTab("?kind=volume", []);
    expect(await screen.findByText("No measurements match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(location().textContent).toBe(`/p/${PROJECT_ID}/measurements`));
  });

  it("shows the error with a Retry and no empty table under it", async () => {
    renderTab("", [], 500);
    expect(await screen.findByText(/Database locked/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("grid", { name: "Measurements" })).toBeNull();
    expect(screen.queryByText("No measurements yet")).toBeNull();
  });

  it("links to the surfaces and volumes view", async () => {
    renderTab();
    await screen.findByText("Fence line");
    fireEvent.click(screen.getByRole("button", { name: "Surfaces and volumes" }));
    await waitFor(() => expect(location().textContent).toBe(`/p/${PROJECT_ID}/measurements/volumes`));
  });
});
