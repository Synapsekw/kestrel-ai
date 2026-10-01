import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Job } from "@contract/client";
import type { BackendMode } from "@/api/backend";
import { useJobsStore } from "@/store/jobs";
import { errorBody, fakeClient, type FakeRoute } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import {
  CONFINED,
  DSM,
  INSPECT_JOB_ID,
  INSPECT_JOB_ID_2,
  LAS,
  LIBRARY_UP,
  MAPPING,
  ORTHO,
  TEMPLATES,
  THERMAL,
  VERTICAL,
  VIDEO,
  VISUAL,
  bucket,
  doneInspectJob,
  draftBucket,
  inspectJob,
  inspectResult,
} from "@/test/setupFixtures";
import type { InspectResult, ProjectTemplate } from "./api";
import { DataCard } from "./DataCard";
import { useSetupDraft } from "./draftStore";
import type { FolderDropHandlers } from "./folderDrop";
import { SAME_FOLDER_NOTE, TRUNCATED_TEXT, VIDEO_NOTE } from "./model";
import { remap } from "./remap";

const drop = vi.hoisted(() => ({
  handlers: null as FolderDropHandlers | null,
  off: vi.fn(),
  pickFolders: vi.fn(),
  pickFiles: vi.fn(),
}));
vi.mock("./folderDrop", () => ({
  subscribeFolderDrop: (h: FolderDropHandlers) => {
    drop.handlers = h;
    return drop.off;
  },
  pickFolders: drop.pickFolders,
  pickFiles: drop.pickFiles,
}));

/** Job reads by id; the next POST /setup/inspect answers with `nextJob`. */
let jobs: Record<string, Job>;
let nextJob: Job;

/** The next sort starts as a running job `id` whose first read is already done with `result`. */
function willSort(id: string, result: InspectResult) {
  nextJob = inspectJob({ id });
  jobs[id] = doneInspectJob(result, { id });
}

function renderData(
  opts: { mode?: BackendMode; routes?: FakeRoute[]; onUse?: (t: ProjectTemplate) => void } = {},
) {
  const { api, requests } = fakeClient([
    ...(opts.routes ?? []),
    { method: "GET", path: /\/library\/status$/, body: LIBRARY_UP },
    { method: "POST", path: /\/setup\/inspect$/, status: 202, body: () => ({ job: nextJob }) },
    {
      method: "POST",
      path: /\/library\/jobs\/[^/]+\/cancel$/,
      body: () => ({ ...nextJob, state: "cancelled" }),
    },
    { method: "GET", path: /\/library\/jobs\/[^/]+$/, body: (req) => jobs[req.url.split("/").pop() ?? ""] },
  ]);
  renderWithProviders(<DataCard templates={TEMPLATES} onUseTemplate={opts.onUse ?? vi.fn()} />, {
    api,
    mode: opts.mode ?? "tauri",
  });
  return requests;
}

async function dropFolder(paths: string[]) {
  await waitFor(() => expect(drop.handlers).not.toBeNull());
  act(() => {
    drop.handlers!.onOver(false);
    drop.handlers!.onDrop(paths);
  });
}

const region = (name: string) => screen.getByRole("region", { name });
const inspects = (requests: { url: string; body?: unknown }[]) =>
  requests.filter((r) => r.url === "/api/v1/setup/inspect");

describe("DataCard", () => {
  beforeEach(() => {
    useSetupDraft.getState().discard();
    useJobsStore.setState({ jobs: {} });
    drop.handlers = null;
    drop.off.mockClear();
    drop.pickFiles.mockReset();
    drop.pickFolders.mockReset();
    jobs = {};
    nextJob = inspectJob();
  });

  it("a dropped folder starts a sort and fills the template's slots", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    willSort(INSPECT_JOB_ID, inspectResult([VISUAL, THERMAL]));
    const requests = renderData();
    await waitFor(() => expect(drop.handlers).not.toBeNull());
    act(() => drop.handlers!.onOver(true));
    expect(screen.getByRole("group", { name: "Drop area" })).toHaveAttribute("data-over", "true");
    await dropFolder(["E:\\DCIM"]);
    await waitFor(() =>
      expect(inspects(requests)[0]?.body).toEqual({ paths: ["E:\\DCIM"], template_id: "builtin-vertical" }),
    );
    const visual = region("Visual photos");
    await within(visual).findByRole("listitem", { name: "100MEDIA · visual" });
    expect(visual).toHaveTextContent("612 photos · 7.8 GB");
    expect(within(visual).getByText("Ready")).toBeInTheDocument();
    expect(
      within(region("Thermal photos")).getByRole("listitem", { name: "100MEDIA · thermal" }),
    ).toBeInTheDocument();
    expect(screen.getByText(SAME_FOLDER_NOTE)).toBeInTheDocument();
  });

  it("dropping a second folder adds to the first", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    willSort(INSPECT_JOB_ID, inspectResult([VISUAL, THERMAL]));
    renderData();
    await dropFolder(["E:\\DCIM"]);
    await within(region("Visual photos")).findByRole("listitem", { name: "100MEDIA · visual" });
    willSort(INSPECT_JOB_ID_2, inspectResult([LAS]));
    await dropFolder(["E:\\Delivery\\scan"]);
    await within(region("3D point cloud")).findByRole("listitem", { name: "tower.las" });
    expect(
      within(region("Visual photos")).getByRole("listitem", { name: "100MEDIA · visual" }),
    ).toBeInTheDocument();
    expect(
      within(region("Thermal photos")).getByRole("listitem", { name: "100MEDIA · thermal" }),
    ).toBeInTheDocument();
  });

  it("shows the sort's progress, and Cancel returns to the drop area", async () => {
    nextJob = inspectJob();
    jobs[INSPECT_JOB_ID] = inspectJob();
    const requests = renderData();
    await dropFolder(["E:\\DCIM"]);
    const status = await screen.findByRole("status", { name: "Sorting files" });
    expect(within(status).getByText("Reading headers 6 / 20")).toBeInTheDocument();
    expect(within(status).getByRole("progressbar", { name: "Sorting progress" })).toHaveAttribute(
      "aria-valuenow",
      "30",
    );
    expect(screen.queryByRole("group", { name: "Drop area" })).toBeNull();
    fireEvent.click(within(status).getByRole("button", { name: "Cancel" }));
    await screen.findByRole("group", { name: "Drop area" });
    expect(requests.some((r) => r.url.endsWith(`/library/jobs/${INSPECT_JOB_ID}/cancel`))).toBe(true);
    expect(useSetupDraft.getState().inspect).toBeNull();
  });

  it("a slot's Browse sorts the picked files into that slot", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    const extra = bucket({
      route: "images",
      match: { thermal: false },
      folder: "E:\\Extra\\IR",
      count: 40,
      bytes: 200_000_000,
    });
    willSort(INSPECT_JOB_ID, inspectResult([extra]));
    drop.pickFiles.mockResolvedValue(["E:\\Extra\\IR"]);
    const requests = renderData();
    fireEvent.click(await screen.findByRole("button", { name: "Browse for Thermal photos" }));
    await within(region("Thermal photos")).findByRole("listitem", { name: "IR · visual" });
    expect(drop.pickFiles).toHaveBeenCalledWith(expect.objectContaining({ key: "thermal" }));
    expect(inspects(requests)[0].body).toMatchObject({ paths: ["E:\\Extra\\IR"] });
  });

  it("a bucket is dragged to another slot, and moved with its menu; a drag it cannot make is refused", async () => {
    useSetupDraft.getState().chooseTemplate(MAPPING, "replace");
    useSetupDraft.getState().setBuckets(remap([draftBucket(ORTHO), draftBucket(DSM)], MAPPING.config.slots));
    renderData();
    const ortho = await screen.findByRole("region", { name: "Orthomosaic" });

    fireEvent.pointerDown(within(ortho).getByRole("button", { name: "Drag ortho_q3.tif" }));
    fireEvent.pointerUp(region("Raw drone images")); // a GeoTIFF is not a photo folder
    expect(within(ortho).getByRole("listitem", { name: "ortho_q3.tif" })).toBeInTheDocument();

    fireEvent.pointerDown(within(ortho).getByRole("button", { name: "Drag ortho_q3.tif" }));
    fireEvent.pointerUp(region("Elevation (DSM / DTM)"));
    expect(
      within(region("Elevation (DSM / DTM)")).getByRole("listitem", { name: "ortho_q3.tif" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Move dsm_q3.tif" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "To Orthomosaic" }));
    expect(within(region("Orthomosaic")).getByRole("listitem", { name: "dsm_q3.tif" })).toBeInTheDocument();
  });

  it("lists a bucket no slot takes under Not used, where it can be skipped and used again", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    useSetupDraft.getState().setBuckets(remap([draftBucket(ORTHO)], VERTICAL.config.slots));
    renderData();
    const unused = await screen.findByRole("region", { name: "Not used by this template" });
    fireEvent.click(within(unused).getByRole("button", { name: "Move ortho_q3.tif" }));
    expect(screen.queryByRole("menuitem", { name: /^To / })).toBeNull(); // no Vertical slot takes a GeoTIFF
    fireEvent.click(screen.getByRole("menuitem", { name: "Skip" }));
    expect(screen.queryByRole("region", { name: "Not used by this template" })).toBeNull();
    fireEvent.click(within(region("Skipped")).getByRole("button", { name: "Use again" }));
    expect(region("Not used by this template")).toBeInTheDocument();
  });

  it("the library is unavailable: it says why, offers no drop, no path and no Browse (S-R3)", async () => {
    useSetupDraft.getState().chooseTemplate(VERTICAL, "replace");
    renderData({
      routes: [
        {
          method: "GET",
          path: /\/library\/status$/,
          body: { ...LIBRARY_UP, available: false, error: "library.db is corrupt" },
        },
      ],
    });
    expect(
      await screen.findByText(
        "Sorting a folder needs the model library, which could not be opened (library.db is corrupt). Create the project now and add data later from its tabs.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Drop area" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Browse for / })).toBeNull();
    expect(drop.off).toHaveBeenCalled();
  });

  it("a start the library refuses switches to the same notice", async () => {
    renderData({
      routes: [
        {
          method: "POST",
          path: /\/setup\/inspect$/,
          status: 503,
          body: errorBody("library_unavailable", "the library could not be opened"),
        },
      ],
    });
    await dropFolder(["E:\\DCIM"]);
    expect(
      await screen.findByText(/which could not be opened \(the library could not be opened\)/),
    ).toBeInTheDocument();
  });

  it("says the walk stopped at 50,000 files and lists what was not recognised", async () => {
    willSort(
      INSPECT_JOB_ID,
      inspectResult([VISUAL], {
        truncated: true,
        not_recognised: {
          count: 2,
          samples: [
            { name: "Thumbs.db", reason: "unknown type" },
            { name: "IMG_backup.zip", reason: "unknown type" },
          ],
        },
      }),
    );
    renderData();
    await dropFolder(["E:\\DCIM"]);
    expect(await screen.findByText(TRUNCATED_TEXT)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^2 files not recognised/ }));
    expect(
      within(screen.getByRole("list", { name: "Not recognised" })).getByText("Thumbs.db"),
    ).toBeInTheDocument();
  });

  it("a video slot says video import is coming and has no Browse (S-R6)", async () => {
    useSetupDraft.getState().chooseTemplate(CONFINED, "replace");
    useSetupDraft.getState().setBuckets(remap([draftBucket(VIDEO)], CONFINED.config.slots));
    renderData();
    const video = await screen.findByRole("region", { name: "Inspection video" });
    expect(within(video).getByText(VIDEO_NOTE)).toBeInTheDocument();
    expect(within(video).getByRole("listitem", { name: "FLIGHT_01.MP4" })).toBeInTheDocument();
    expect(within(video).queryByRole("button", { name: "Browse for Inspection video" })).toBeNull();
    expect(screen.getByRole("button", { name: "Browse for Stills" })).toBeInTheDocument();
  });

  it("suggests the template the files fit, through the page's choice", async () => {
    willSort(INSPECT_JOB_ID, inspectResult([VISUAL, THERMAL], { suggested_template_id: "builtin-vertical" }));
    const onUse = vi.fn();
    renderData({ onUse });
    await dropFolder(["E:\\DCIM"]);
    expect(await screen.findByText("These files look like Vertical asset inspection.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Use it" }));
    expect(onUse).toHaveBeenCalledWith(VERTICAL);
  });

  it.each(["mock", "tauri"] as const)("the path field sorts one typed path (%s)", async (mode) => {
    willSort(INSPECT_JOB_ID, inspectResult([VISUAL]));
    const requests = renderData({ mode });
    const field = await screen.findByRole("textbox", { name: "Folder or file path" });
    fireEvent.change(field, { target: { value: "DCIM" } });
    fireEvent.click(screen.getByRole("button", { name: "Sort files" }));
    expect(screen.getByText("Type a full path, such as E:\\DCIM\\100MEDIA.")).toBeInTheDocument();
    expect(inspects(requests)).toHaveLength(0);
    fireEvent.change(field, { target: { value: "\\\\nas\\deliveries\\DCIM" } });
    fireEvent.click(screen.getByRole("button", { name: "Sort files" }));
    await waitFor(() =>
      expect(inspects(requests)[0]?.body).toEqual({ paths: ["\\\\nas\\deliveries\\DCIM"] }),
    );
    expect(screen.queryByRole("button", { name: "Browse folders" }) !== null).toBe(mode === "tauri");
  });

  it("a folder dropped while a sort runs is not queued and says so", async () => {
    nextJob = inspectJob();
    jobs[INSPECT_JOB_ID] = inspectJob();
    const requests = renderData();
    await dropFolder(["E:\\DCIM"]);
    await screen.findByRole("status", { name: "Sorting files" });
    await dropFolder(["E:\\Other"]);
    expect(
      await screen.findByText("Sorting in progress. Drop the next folder when it finishes."),
    ).toBeInTheDocument();
    expect(inspects(requests)).toHaveLength(1);
  });

  it("a drop of more than 16 items sorts the first 16 and says how many are left", async () => {
    nextJob = inspectJob();
    jobs[INSPECT_JOB_ID] = inspectJob();
    const requests = renderData();
    await dropFolder(Array.from({ length: 20 }, (_, i) => `E:\\F${i}`));
    const status = await screen.findByRole("status", { name: "Sorting files" });
    expect(
      within(status).getByText("Sorting the first 16 of 20 items. Drop the other 4 when this sort finishes."),
    ).toBeInTheDocument();
    expect((inspects(requests)[0].body as { paths: string[] }).paths).toHaveLength(16);
    fireEvent.click(within(status).getByRole("button", { name: "Cancel" }));
    await screen.findByRole("group", { name: "Drop area" });
    expect(screen.queryByText(/Sorting the first 16/)).toBeNull();
  });

  it("keeps the typed path when the sort fails to start", async () => {
    renderData({
      routes: [
        {
          method: "POST",
          path: /\/setup\/inspect$/,
          status: 422,
          body: errorBody("invalid_paths", "it broke"),
        },
      ],
    });
    const field = await screen.findByRole("textbox", { name: "Folder or file path" });
    fireEvent.change(field, { target: { value: "E:\\DCIM" } });
    fireEvent.click(screen.getByRole("button", { name: "Sort files" }));
    await screen.findByText(/it broke/);
    expect(field).toHaveValue("E:\\DCIM");
  });
});
