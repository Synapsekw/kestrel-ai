import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { exampleProject, fakeClient, PROJECT_ID } from "@/test/fixtures";
import { MODEL_REVIEWED } from "@/test/assetFindingFixtures";
import { useJobsStore } from "@/store/jobs";
import { reportedInline } from "@/ui";
import { ReviewImportDialog } from "./ReviewImportDialog";

vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => "D:\\kits\\tower\\job") }));

const SOURCE = {
  id: "src-1",
  kind: "images",
  label: "Flight 14 Sep",
  captured_on: null,
  map_id: null,
  folder: "D:\\photos",
  site: null,
  settings: {},
  image_count: 3,
  duplicate_count: 0,
  job_id: null,
  imported_at: null,
  created_at: "",
};

const PREVIEW = {
  dry_run: true,
  unit: "region",
  profile: "building-facade",
  profile_id: "building_facade",
  photos: 3,
  matched: 2,
  matched_by: { path: 2 },
  unmatched_count: 1,
  unmatched: ["flight-b/DJI_0003.JPG"],
  unmatched_reasons: [{ kit_id: "p03", source_name: "flight-b/DJI_0003.JPG", reason: "not_found" }],
  classes: [
    { key: "cladding", label: "Cladding damage", count: 2, type_id: "t-clad" },
    { key: "staining", label: "Staining", count: 1, type_id: null },
  ],
  statuses: { finding: 2, none: 0, uncertain: 0, not_assessed: 0 },
  sightings: 3,
  has_surface: true,
  has_glb: false,
  has_merged: true,
  model: { ready_version: 2, existing_sightings: 0 },
};

const job = (id: string, dry: boolean, extra: object = {}) => ({
  id,
  project_id: PROJECT_ID,
  type: "review_kit_import",
  state: "succeeded",
  progress: 1,
  message: "",
  log_path: "",
  params: { dry_run: dry },
  result: dry ? PREVIEW : null,
  error: null,
  created_at: "",
  started_at: null,
  finished_at: null,
  ...extra,
});

const CLASSES = [
  {
    id: "t-clad",
    name: "Cladding damage",
    colour: "#f97316",
    hotkey: null,
    order: 0,
    kind: "defect",
    default_severity: null,
    group: null,
  },
  {
    id: "t-staining",
    name: "Stain marks",
    colour: "#3b82f6",
    hotkey: null,
    order: 1,
    kind: "defect",
    default_severity: null,
    group: null,
  },
];

function setup(extra: unknown[] = [], mode: "mock" | "tauri" = "mock") {
  let n = 0;
  const client = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: { ...exampleProject, classes: CLASSES } },
    ...extra,
    { method: "GET", path: /\/sources$/, body: { items: [SOURCE], next_cursor: null } },
    { method: "GET", path: /\/asset-models$/, body: { items: [MODEL_REVIEWED] } },
    {
      method: "POST",
      path: /\/review-imports$/,
      status: 202,
      body: (r: { body: unknown }) => ({ job: job(`j${++n}`, (r.body as { dry_run: boolean }).dry_run) }),
    },
  ] as never);
  const onStarted = vi.fn();
  renderWithProviders(
    <ReviewImportDialog projectId={PROJECT_ID} modelId="m1" onClose={() => {}} onStarted={onStarted} />,
    { api: client.api, mode },
  );
  return { ...client, onStarted };
}

afterEach(() => useJobsStore.setState({ jobs: {} }));

describe("ReviewImportDialog", () => {
  it("checks the folder, shows the preview, maps the classes and starts the import", async () => {
    const { requests, onStarted } = setup();
    fireEvent.change(screen.getByLabelText(/review job folder/i), {
      target: { value: "D:\\kits\\tower\\job" },
    });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));

    const preview = await screen.findByRole("region", { name: /what this import will do/i });
    expect(preview).toHaveTextContent("building-facade");
    expect(preview).toHaveTextContent("2 of 3 photos matched");
    expect(preview).toHaveTextContent("2 by path");
    expect(preview).toHaveTextContent("3 sightings");
    const unmatched = within(preview).getByRole("list", { name: /photos not matched/i });
    expect(unmatched).toHaveTextContent("flight-b/DJI_0003.JPG");
    expect(unmatched).toHaveTextContent("No image with this name in the image set");

    // "staining" has no suggestion and no name match: Import waits until it has a type
    const importButton = screen.getByRole("button", { name: /^import$/i });
    expect(importButton).toBeDisabled();
    expect(screen.getByText(/1 class still needs a type/i)).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /staining/i });
    fireEvent.click(within(row).getByRole("button", { name: /type for staining/i }));
    fireEvent.click(await screen.findByRole("option", { name: /^stain marks$/i }));
    await waitFor(() => expect(importButton).toBeEnabled());
    fireEvent.click(importButton);

    await waitFor(() => expect(onStarted).toHaveBeenCalled());
    const posts = requests.filter((r) => r.method === "POST").map((r) => r.body);
    expect(posts[0]).toEqual({
      folder: "D:\\kits\\tower\\job",
      image_source_id: "src-1",
      asset_model_id: "m1",
      dry_run: true,
    });
    expect(posts[1]).toEqual({
      folder: "D:\\kits\\tower\\job",
      image_source_id: "src-1",
      asset_model_id: "m1",
      dry_run: false,
      class_map: { cladding: "t-clad", staining: "t-staining" },
    });
    expect(useJobsStore.getState().jobs.j2).toBeDefined();
  });

  it("claims the dry run's outcome so the global toast stays quiet", async () => {
    setup();
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\k" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    await screen.findByRole("region", { name: /what this import will do/i });
    expect(reportedInline(job("j1", true) as never, "/p/x/models/m1")).toBe(true);
  });

  it("shows the server's reason for a folder that is not a review job", async () => {
    setup([
      {
        method: "POST",
        path: /\/review-imports$/,
        status: 422,
        body: { error: { code: "kit_invalid", message: "This folder has no job.yaml.", details: {} } },
      },
    ]);
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\nothing" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    expect(await screen.findByText(/no job\.yaml/i)).toBeInTheDocument();
  });

  it("shows a failed dry run's message", async () => {
    setup([
      {
        method: "POST",
        path: /\/review-imports$/,
        status: 202,
        body: {
          job: job("jf", true, { state: "failed", result: null, error: "Unknown review profile: chimney." }),
        },
      },
    ]);
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\k" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    expect(await screen.findByText(/unknown review profile: chimney/i)).toBeInTheDocument();
  });

  it("stops checking and says so when the dry run ends without a preview", async () => {
    setup([
      {
        method: "POST",
        path: /\/review-imports$/,
        status: 202,
        body: { job: job("jc", true, { state: "cancelled", result: null }) },
      },
    ]);
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\k" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    expect(await screen.findByText(/the check ended without a preview/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /check the folder/i })).toBeEnabled();
  });

  it("picks the folder with the Tauri dialog in the desktop app", async () => {
    setup([], "tauri");
    fireEvent.click(screen.getByRole("button", { name: /^browse$/i }));
    await waitFor(() =>
      expect(screen.getByLabelText(/review job folder/i)).toHaveValue("D:\\kits\\tower\\job"),
    );
  });

  it("imports into a new asset model by name", async () => {
    const { requests } = setup();
    fireEvent.change(screen.getByLabelText(/review job folder/i), { target: { value: "D:\\k" } });
    await screen.findByRole("option", { name: /flight 14 sep/i });
    fireEvent.change(screen.getByLabelText(/^asset model$/i), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText(/new asset model name/i), { target: { value: "Tower B" } });
    fireEvent.click(screen.getByRole("button", { name: /check the folder/i }));
    await screen.findByRole("region", { name: /what this import will do/i });
    expect(requests.find((r) => r.method === "POST")!.body).toMatchObject({ new_model_name: "Tower B" });
    expect(requests.find((r) => r.method === "POST")!.body).not.toHaveProperty("asset_model_id");
  });
});
