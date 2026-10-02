import { useEffect } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CloudMeasurement } from "@/api/cloudMeasurements";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { CLOUD_ID, exampleCloud } from "@/test/cloudFixtures";
import { exampleFinding, FINDING_ID } from "@/test/findingFixtures";
import { renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { WorkspaceSeamsContext, type WorkspaceSeams } from "../workspace/seams";
import { MeasurementDetail, MeasurementsList } from "./MeasurementsTab";
import { useCloudMeasurements, type CloudMeasurements } from "./useCloudMeasurements";

const base = {
  point_cloud_id: CLOUD_ID,
  note: null,
  params: null,
  status: "ready",
  error: null,
  job_id: null,
  finding_id: null,
  view: null,
  created_at: "2026-09-27T10:00:00Z",
  updated_at: "2026-09-27T10:00:00Z",
};
const sq = [
  { x: 0, y: 0, z: 0, uncertainty_m: 0.01 },
  { x: 1, y: 0, z: 0, uncertainty_m: 0.01 },
  { x: 1, y: 1, z: 0, uncertainty_m: 0.01 },
];
const area = {
  ...base,
  id: "a1",
  kind: "area",
  name: "Area 1",
  points: sq,
  params: { mode: "surface" },
  results: { area_m2: 0.5, area_surface_m2: 0.5, area_plan_m2: 0.5, plane_rms_m: 0 },
} as unknown as CloudMeasurement;
const line = [
  { x: 0, y: 0, z: 5, uncertainty_m: 0.01 },
  { x: 12, y: 0, z: 5, uncertainty_m: 0.01 },
];
const computing = {
  ...base,
  id: "p1",
  kind: "profile",
  name: "Cross-section 1",
  points: line,
  status: "computing",
  results: {},
} as unknown as CloudMeasurement;
const failed = {
  ...base,
  id: "p2",
  kind: "profile",
  name: "Cross-section 2",
  points: line,
  status: "failed",
  error: "the source file changed since import; import it again",
  results: {},
} as unknown as CloudMeasurement;

const seams: WorkspaceSeams = {
  requestViewCapture: vi.fn(),
  ReportViewCard: ({ subject }) => <p>view card for {subject.id}</p>,
  LikelyViews: null,
};

function Harness({
  onReady,
  onSelect = vi.fn(),
  onRetry = vi.fn().mockResolvedValue(undefined),
  only,
}: {
  onReady(l: CloudMeasurements): void;
  /** Which half to render; both by default. */
  only?: "list" | "detail";
  onSelect?: (m: CloudMeasurement) => void;
  onRetry?: (m: CloudMeasurement) => Promise<unknown>;
}) {
  const list = useCloudMeasurements(PROJECT_ID, CLOUD_ID);
  useEffect(() => {
    onReady(list);
  });
  return (
    <WorkspaceSeamsContext.Provider value={seams}>
      {only !== "detail" && (
        <MeasurementsList
          projectId={PROJECT_ID}
          cloud={exampleCloud}
          list={list}
          onSelect={onSelect}
          onRetry={onRetry}
        />
      )}
      {only !== "list" && <MeasurementDetail projectId={PROJECT_ID} cloud={exampleCloud} list={list} />}
    </WorkspaceSeamsContext.Provider>
  );
}

function mount(
  items: CloudMeasurement[],
  extra: Parameters<typeof fakeClient>[0] = [],
  props: Partial<Parameters<typeof Harness>[0]> = {},
) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/pointclouds\/[^/]+\/measurements$/, body: { items } },
    {
      method: "GET",
      path: /\/findings$/,
      body: {
        items: [
          {
            ...exampleFinding,
            anchor: { kind: "cloud", cloud_id: CLOUD_ID, x: 0, y: 0, z: 0, uncertainty_m: 0.02 },
          },
        ],
        next_cursor: null,
      },
    },
    ...extra,
  ]);
  let list: CloudMeasurements | null = null;
  renderWithProviders(<Harness onReady={(l) => (list = l)} {...props} />, { api });
  return { requests, list: () => list! };
}

describe("Measurements tab", () => {
  beforeEach(() => useChangesStore.setState({ pointcloudsRevision: 0 }));

  it("the list shows rows and Copy all as CSV, never the selected row's details", async () => {
    const { list } = mount([area], [], { only: "list" });
    await screen.findByRole("button", { name: /Area 1/ });
    expect(screen.getByRole("button", { name: "Copy all as CSV" })).toBeInTheDocument();
    act(() => list().select("a1"));
    await waitFor(() => expect(list().selectedId).toBe("a1"));
    expect(screen.queryByRole("region", { name: "Details of Area 1" })).toBeNull();
  });

  it("the list scrolls inside the rail panel: it may shrink and its rows overflow (C1)", async () => {
    mount([area], [], { only: "list" });
    const ul = await screen.findByRole("list", { name: "Saved measurements" });
    expect(ul).toHaveClass("min-h-0", "flex-1", "overflow-y-auto");
    expect(ul.parentElement).toHaveClass("min-h-0", "flex-1");
  });

  it("the detail shows only the selected row's details, and nothing without a selection", async () => {
    const { list } = mount([area], [], { only: "detail" });
    await waitFor(() => expect(list().loaded).toBe(true));
    expect(screen.queryByRole("region", { name: /^Details of/ })).toBeNull();
    expect(screen.queryByRole("list", { name: "Saved measurements" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy all as CSV" })).toBeNull();
    act(() => list().select("a1"));
    expect(await screen.findByRole("region", { name: "Details of Area 1" })).toBeInTheDocument();
  });

  it("lists each measurement with its value, and a profile's state", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    mount([area, computing, failed], [], { onRetry });
    const rows = await screen.findByRole("list", { name: "Saved measurements" });
    expect(within(rows).getByRole("button", { name: /Area 1/ })).toHaveTextContent("0.50 m²");
    expect(within(rows).getByRole("button", { name: /Cross-section 1/ })).toHaveTextContent(
      "Cutting the profile…",
    );
    expect(within(rows).getByRole("button", { name: /Cross-section 2/ })).toHaveTextContent(
      "the source file changed",
    );
    await userEvent.click(within(rows).getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledWith(failed);
  });

  it("disables a row's own Retry while its request is pending, and does not fire twice", async () => {
    let resolve: () => void = () => {};
    const onRetry = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    mount([failed], [], { onRetry });
    const button = await screen.findByRole("button", { name: "Retry" });
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
    await act(async () => resolve());
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("unlocks a row's Retry after a rejection or a synchronous throw, with no unhandled rejection", async () => {
    const onRetry = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementationOnce(() => {
        throw new Error("sync");
      });
    mount([failed], [], { onRetry });
    const button = await screen.findByRole("button", { name: "Retry" });
    await userEvent.click(button);
    await waitFor(() => expect(button).toBeEnabled());
    await userEvent.click(button);
    await waitFor(() => expect(onRetry).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(button).toBeEnabled());
  });

  it("hands a clicked row to the workspace", async () => {
    const onSelect = vi.fn();
    mount([area], [], { onSelect });
    await userEvent.click(await screen.findByRole("button", { name: /Area 1/ }));
    expect(onSelect).toHaveBeenCalledWith(area);
  });

  it("shows the selected row's details, renames it and attaches it to a finding", async () => {
    const { requests, list } = mount(
      [area],
      [{ method: "PATCH", path: /\/measurements\/a1$/, body: (r) => ({ ...area, ...(r.body as object) }) }],
    );
    await screen.findByRole("button", { name: /Area 1/ });
    act(() => list().select("a1"));
    const details = await screen.findByRole("region", { name: "Details of Area 1" });
    expect(within(details).getByText("Surface area")).toBeInTheDocument();
    expect(within(details).getByText("view card for a1")).toBeInTheDocument();
    const name = within(details).getByRole("textbox", { name: "Name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Spalled patch");
    await userEvent.tab();
    await waitFor(() =>
      expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ name: "Spalled patch" }),
    );
    await userEvent.click(within(details).getByRole("button", { name: /^Attach to finding/ }));
    await userEvent.click(await screen.findByRole("option", { name: /^F-0217/ }));
    await waitFor(() =>
      expect(requests.filter((r) => r.method === "PATCH").at(-1)?.body).toEqual({ finding_id: FINDING_ID }),
    );
  });

  it("deletes the selected row", async () => {
    const { list } = mount([area], [{ method: "DELETE", path: /\/measurements\/a1$/, status: 204 }]);
    await screen.findByRole("button", { name: /Area 1/ });
    act(() => list().select("a1"));
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Area 1/ })).toBeNull());
  });

  it("copies all as CSV", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount([area]);
    await screen.findByRole("button", { name: /Area 1/ });
    await userEvent.click(screen.getByRole("button", { name: "Copy all as CSV" }));
    expect(String(writeText.mock.calls[0][0]).split("\r\n")[0]).toContain("vertex_count,geometry_wkt");
  });

  it("states the 1 000 cap where it bites", async () => {
    mount(Array.from({ length: 1000 }, (_, i) => ({ ...area, id: `a${i}`, name: `Area ${i}` })));
    expect(await screen.findByText("1 000 of 1 000: delete one to save another")).toBeInTheDocument();
  });
});
