import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  ASSET_FINDING_ID_2,
  ASSET_MODEL_ID,
  exampleAssetFinding,
  exampleAssetFinding2,
  exampleAssetModel,
} from "@/test/assetFindingFixtures";
import { baseRoutes, exampleFinding } from "@/test/findingFixtures";
import { fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { FindingsScreen } from "./FindingsScreen";

function renderTab(search = "", opts: { items?: object[]; models?: object[] } = {}) {
  const routes: FakeRoute[] = [
    {
      method: "GET",
      path: /\/findings$/,
      body: { items: opts.items ?? [exampleAssetFinding, exampleAssetFinding2], next_cursor: null },
    },
    { method: "GET", path: /\/asset-models$/, body: { items: opts.models ?? [exampleAssetModel] } },
  ];
  const { api, requests } = fakeClient(baseRoutes(routes));
  renderWithProviders(
    <>
      <FindingsScreen />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/findings${search}`, path: "/p/:projectId/findings/:findingId?" },
  );
  return requests;
}

const lastListQuery = (requests: { url: string }[]) =>
  new URL(requests.filter((r) => /\/findings\?/.test(r.url)).at(-1)!.url, "http://fake").searchParams;

describe("FindingsScreen with asset findings", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 }));

  it("shows the asset columns when an asset finding is in view", async () => {
    renderTab();
    const row = (await screen.findByText("F-0401")).closest('[role="row"]') as HTMLElement;
    expect(screen.getByRole("columnheader", { name: "Height" })).toBeInTheDocument();
    expect(within(row).getByText("42.5 m")).toBeInTheDocument();
    expect(within(row).getByText("Shaft")).toBeInTheDocument();
    expect(within(row).getByText("3")).toBeInTheDocument();
  });

  it("hides the asset columns for a register with no asset finding", async () => {
    renderTab("", { items: [exampleFinding], models: [] });
    await screen.findByText("F-0217");
    expect(screen.queryByRole("columnheader", { name: "Height" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Photo outcomes" })).not.toBeInTheDocument();
  });

  it("sends the asset filters from the URL", async () => {
    const requests = renderTab(`?anchor_kind=asset&asset_model_id=${ASSET_MODEL_ID}&zone=shaft&placed=true`);
    await screen.findByText("F-0401");
    const q = lastListQuery(requests);
    expect(q.getAll("anchor_kind")).toEqual(["asset"]);
    expect(q.get("asset_model_id")).toBe(ASSET_MODEL_ID);
    expect(q.getAll("zone")).toEqual(["shaft"]);
    expect(q.get("placed")).toBe("true");
    expect(q.get("view")).toBeNull();
  });

  it("switches to the gallery, keeps it in the URL, and opens a finding from a tile", async () => {
    renderTab();
    await screen.findByText("F-0401");
    fireEvent.click(screen.getByRole("radio", { name: "Gallery" }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("view=gallery"));
    expect(screen.queryByRole("grid", { name: "Findings" })).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "F-0402 Crack" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/findings/${ASSET_FINDING_ID_2}?view=gallery`,
      ),
    );
  });

  it("links the photo outcome chips to the image browser by review status", async () => {
    renderTab();
    const nav = await screen.findByRole("navigation", { name: "Photo outcomes" });
    expect(within(nav).getByRole("link", { name: "Uncertain photos" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images?review=uncertain`,
    );
    expect(within(nav).getByRole("link", { name: "No finding" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images?review=none`,
    );
    expect(within(nav).getByRole("link", { name: "All photos" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images?review=all`,
    );
  });
});
