import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import {
  errorBody,
  exampleProject,
  fakeClient,
  PROJECT_ID,
  runningJob,
  type FakeRoute,
} from "@/test/fixtures";
import {
  exampleCataloguePage,
  exampleLibraryDataset,
  examplePreview,
  exampleTypes,
  TYPE_ID,
} from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { useJobsStore } from "@/store/jobs";
import { DatasetBuilder } from "./DatasetBuilder";

const PROJECTS: FakeRoute = {
  method: "GET",
  path: /\/api\/v1\/projects$/,
  body: { items: [exampleProject], next_cursor: null },
};
const TYPES: FakeRoute = { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage };
const PREVIEW: FakeRoute = { method: "POST", path: /\/preview$/, body: examplePreview };

function renderBuilder(routes: FakeRoute[] = [PROJECTS, TYPES, PREVIEW], types = [TYPE_ID(1), TYPE_ID(2)]) {
  const { api, requests } = fakeClient(routes);
  const onCreated = vi.fn();
  const onClose = vi.fn();
  renderWithProviders(
    <DatasetBuilder
      initialProjectIds={[PROJECT_ID]}
      initialTypeIds={types}
      onCreated={onCreated}
      onClose={onClose}
    />,
    { api },
  );
  return { requests, onCreated, onClose };
}

describe("DatasetBuilder (F §12.2, §12.4)", () => {
  it("preselects the link's project and types and shows the live counts", async () => {
    renderBuilder();
    expect(await screen.findByLabelText("Ahmadia")).toBeChecked();
    expect(await screen.findByLabelText("Dump truck")).toBeChecked();
    expect(screen.getByLabelText("Crack")).not.toBeChecked();
    expect(screen.queryByLabelText("Spalling")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("preview-images")).toHaveTextContent("30"));
    expect(within(screen.getByTestId("preview-types")).getByText("72")).toBeInTheDocument();
  });

  it("creates the dataset as a build job and hands it over", async () => {
    const created = {
      ...exampleLibraryDataset,
      id: "d-new",
      name: "machines-v2",
      state: "resolving" as const,
    };
    const job = { ...runningJob, id: "j-build", project_id: "library", type: "dataset_build" as const };
    const { requests, onCreated } = renderBuilder([
      PROJECTS,
      TYPES,
      PREVIEW,
      { method: "POST", path: /\/library\/datasets$/, status: 202, body: { dataset: created, job } },
    ]);
    await screen.findByLabelText("Dump truck");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "machines-v2" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created));
    expect(requests.find((r) => r.method === "POST" && r.url.endsWith("/library/datasets"))?.body).toEqual({
      name: "machines-v2",
      task: "detect",
      filter: {
        project_ids: [PROJECT_ID],
        type_ids: [TYPE_ID(1), TYPE_ID(2)],
        captured_from: null,
        captured_to: null,
        reviewed_only: true,
        boxes_as_polygons: false,
      },
      split_method: "by_group",
      val_fraction: 0.2,
      seed: 42,
    });
    expect(useJobsStore.getState().jobs["j-build"]?.type).toBe("dataset_build");
  });

  it("refuses to create without a type, before sending", async () => {
    const { requests } = renderBuilder([PROJECTS, TYPES, PREVIEW], []);
    await screen.findByLabelText("Dump truck");
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    expect(screen.getByText("Choose at least one type.")).toBeInTheDocument();
    expect(requests.some((r) => r.url.endsWith("/library/datasets"))).toBe(false);
  });

  it("says when nothing matches and keeps Create off", async () => {
    renderBuilder([
      PROJECTS,
      TYPES,
      { method: "POST", path: /\/preview$/, body: { ...examplePreview, images: 0 } },
    ]);
    expect(await screen.findByText("No labelled images match this filter.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create dataset" })).toBeDisabled();
  });

  it("explains that types cannot be chosen while the catalogue is unavailable", async () => {
    renderBuilder([
      PROJECTS,
      PREVIEW,
      {
        method: "GET",
        path: /\/catalogue\/types$/,
        status: 503,
        body: errorBody("catalogue_unavailable", "locked"),
      },
    ]);
    expect(
      await screen.findByText(
        "The catalogue is not available, so types cannot be chosen. Check the Catalogue section.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create dataset" })).toBeDisabled();
  });

  it("offers polygons, with boxes as polygons, and says how many images the task skips", async () => {
    const { requests } = renderBuilder([
      PROJECTS,
      TYPES,
      { ...PREVIEW, body: { ...examplePreview, skipped_by_task: 12 } },
    ]);
    fireEvent.click(await screen.findByRole("radio", { name: "Polygons" }));
    expect(
      await screen.findByText(
        "12 of 30 images will be skipped: they hold boxes or point markers of the chosen types.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Boxes as polygons/));
    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            /task=segment/.test(r.url) &&
            (r.body as { boxes_as_polygons?: boolean } | null)?.boxes_as_polygons === true,
        ),
      ).toBe(true),
    );
  });

  it("shows no skipped line when the chosen task skips nothing", async () => {
    renderBuilder();
    await waitFor(() => expect(screen.getByTestId("preview-images")).toHaveTextContent("30"));
    expect(screen.queryByText(/will be skipped/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Boxes as polygons/)).not.toBeInTheDocument();
  });

  it("says the project list failed instead of claiming there are no projects", async () => {
    renderBuilder([
      TYPES,
      PREVIEW,
      { method: "GET", path: /\/api\/v1\/projects$/, status: 500, body: errorBody("internal", "disk error") },
    ]);
    expect(screen.queryByText("No recent projects. Open one from Projects first.")).not.toBeInTheDocument();
    expect(await screen.findByText("The project list could not be loaded")).toBeInTheDocument();
    expect(screen.queryByText("No recent projects. Open one from Projects first.")).not.toBeInTheDocument();
  });

  it("says the catalogue failed to load when it is not merely unavailable", async () => {
    renderBuilder([
      PROJECTS,
      PREVIEW,
      { method: "GET", path: /\/catalogue\/types$/, status: 500, body: errorBody("internal", "boom") },
    ]);
    expect(await screen.findByText("The catalogue could not be loaded")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select all" })).not.toBeInTheDocument();
  });

  it("Select all picks at most 200 types, in the shown order, and says so", async () => {
    const many = Array.from({ length: 205 }, (_, i) => ({
      ...exampleTypes[0],
      id: `t-many-${i}`,
      name: `Type ${String(i).padStart(3, "0")}`,
      hotkey: null,
    }));
    renderBuilder(
      [
        PROJECTS,
        PREVIEW,
        {
          method: "GET",
          path: /\/catalogue\/types$/,
          body: { items: many, next_cursor: null, needs_classification: false },
        },
      ],
      [],
    );
    fireEvent.click(await screen.findByRole("button", { name: "Select all" }));
    expect(screen.getByLabelText("Type 000")).toBeChecked();
    expect(screen.getByLabelText("Type 199")).toBeChecked();
    expect(screen.getByLabelText("Type 200")).not.toBeChecked();
    expect(
      screen.getByText("Select all picks the first 200 types: a dataset holds at most 200."),
    ).toBeInTheDocument();
  });
});
