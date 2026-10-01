import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useAddData } from "@/app/addDataStore";
import { takeImportPrefill } from "@/mapws/drawings/importPrefill";
import { useSetupImports } from "@/setup/dispatch";
import type { ImportUnit, OmittedFiles } from "@/setup/importPlan";
import { exampleSource, fakeClient, PROJECT_ID, runningJob, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Banners } from "./Banners";
import { SetupNotice } from "./SetupNotice";

const PHOTOS = "E:\\Delivery\\DCIM\\100MEDIA";
const LABELS: Record<string, string> = {
  visual: "Visual photos",
  thermal: "Thermal photos",
  ortho: "Orthomosaic",
  drawings: "Asset drawings",
};

function unit(patch: Partial<ImportUnit> & Pick<ImportUnit, "route" | "path" | "slotKeys">): ImportUnit {
  return { id: `${patch.route}:${patch.path.toLowerCase()}`, state: "started", ...patch };
}

function seed(units: ImportUnit[], omitted: OmittedFiles[] = []) {
  const labels = Object.fromEntries(units.flatMap((u) => u.slotKeys).map((k) => [k, LABELS[k]]));
  useSetupImports.setState({ byProject: { [PROJECT_ID]: { labels, units, omitted } } });
}

function show(routes: FakeRoute[] = []) {
  const client = fakeClient(routes);
  renderWithProviders(<SetupNotice projectId={PROJECT_ID} />, { api: client.api });
  return client;
}

const FAILED_FOLDER = unit({
  route: "images",
  path: PHOTOS,
  slotKeys: ["visual", "thermal"],
  state: "failed",
  error: "an import of this folder is already running",
});

beforeEach(() => {
  useSetupImports.setState({ byProject: {} });
  useAddData.setState({ open: false, tile: null, projectId: PROJECT_ID });
});

describe("SetupNotice", () => {
  it("says nothing once every import has started", () => {
    seed([unit({ route: "images", path: PHOTOS, slotKeys: ["visual", "thermal"] })]);
    show();
    expect(screen.queryByTestId("setup-notice")).toBeNull();
  });

  it("says the imports are starting while the requests are out", () => {
    seed([
      unit({ route: "images", path: PHOTOS, slotKeys: ["visual"], state: "pending" }),
      unit({ route: "map", path: "E:\\D\\ortho.tif", slotKeys: ["ortho"], state: "pending" }),
    ]);
    show();
    expect(screen.getByText("Setup: starting 2 imports…")).toBeInTheDocument();
  });

  it("lists a failed import under each slot it fills, and Retry starts only that import", async () => {
    seed([
      FAILED_FOLDER,
      unit({ route: "map", path: "E:\\D\\ortho.tif", slotKeys: ["ortho"], jobId: "j-map" }),
    ]);
    const { requests } = show([
      { method: "POST", path: /\/sources$/, status: 202, body: { source: exampleSource, job: runningJob } },
    ]);
    expect(screen.getByText("Setup: 1 import failed")).toBeInTheDocument();
    expect(screen.getByText("Visual photos")).toBeInTheDocument();
    expect(screen.getByText("Thermal photos")).toBeInTheDocument();
    expect(screen.getAllByText("an import of this folder is already running")).toHaveLength(2);
    expect(screen.queryByText("Orthomosaic")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry Thermal photos" }));
    await waitFor(() => expect(screen.queryByTestId("setup-notice")).toBeNull());
    expect(requests.map((r) => [r.method, r.url, r.body])).toEqual([
      ["POST", `/api/v1/projects/${PROJECT_ID}/sources`, { folder: PHOTOS }],
    ]);
  });

  it("offers Finish drawing import for a drawing that needs a choice", () => {
    seed([
      unit({
        route: "drawing",
        path: "E:\\D\\plans\\tower.pdf",
        slotKeys: ["drawings"],
        state: "needs_choice",
        error: "This PDF has 3 pages. Choose the page to import.",
      }),
    ]);
    show();
    expect(screen.getByText("Setup: 1 drawing needs your choice")).toBeInTheDocument();
    expect(screen.getByText("tower.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Finish drawing import" }));
    expect(takeImportPrefill()).toBe("E:\\D\\plans\\tower.pdf");
    expect(useAddData.getState()).toMatchObject({ open: true, tile: "drawing" });
  });

  it("names the files setup did not start and the tab that imports them", () => {
    seed(
      [unit({ route: "map", path: "E:\\D\\ortho\\tile-0.tif", slotKeys: ["ortho"] })],
      [{ slotKey: "ortho", folder: "E:\\D\\ortho", count: 50, tab: "Maps" }],
    );
    show();
    expect(screen.getByText("Setup: 50 files not started")).toBeInTheDocument();
    expect(
      screen.getByText("50 more files in E:\\D\\ortho were not started — import them from the Maps tab"),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Retry/ })).toBeNull();
  });

  it("goes away for good when dismissed", () => {
    seed([FAILED_FOLDER]);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("setup-notice")).toBeNull();
    expect(useSetupImports.getState().byProject).toEqual({});
  });

  it("is shown among the Overview's banners", async () => {
    seed([FAILED_FOLDER]);
    const client = fakeClient([
      { method: "GET", path: /\/adoption$/, body: { pending: 0, adopted: 0, missing: [], job_id: null } },
    ]);
    renderWithProviders(<Banners projectId={PROJECT_ID} banners={[]} />, { api: client.api });
    expect(await screen.findByText("Setup: 1 import failed")).toBeInTheDocument();
  });
});
