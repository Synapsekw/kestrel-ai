import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleProject, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import {
  exampleCataloguePage,
  exampleProjectClasses,
  exampleTypes,
  TYPE_ID,
} from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { ProjectTypesSection } from "./ProjectTypesSection";

const project = { ...exampleProject, classes: exampleProjectClasses };
const TYPES: FakeRoute = { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage };

const TYPES_503: FakeRoute = {
  method: "GET",
  path: /\/catalogue\/types$/,
  status: 503,
  body: errorBody("catalogue_unavailable", "locked"),
};

function renderSection(routes: FakeRoute[], types: FakeRoute = TYPES) {
  const { api, requests } = fakeClient([types, ...routes]);
  const onSaved = vi.fn();
  renderWithProviders(<ProjectTypesSection project={project} onSaved={onSaved} />, { api });
  return { requests, onSaved };
}

describe("ProjectTypesSection", () => {
  it("adds a catalogue type from the one field and saves the ordered list", async () => {
    const { requests, onSaved } = renderSection([
      { method: "PUT", path: /\/projects\/[^/]+\/types$/, body: project },
    ]);
    await screen.findByRole("button", { name: "Move Excavator down" });
    fireEvent.change(screen.getByLabelText("Add type"), { target: { value: "dump" } });
    fireEvent.click(await screen.findByRole("button", { name: "Add Dump truck" }));
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(requests.find((r) => r.method === "PUT")?.url).toBe(`/api/v1/projects/${PROJECT_ID}/types`);
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({
      type_ids: [TYPE_ID(1), TYPE_ID(3), TYPE_ID(2)],
      hotkeys: { [TYPE_ID(1)]: "9" },
    });
  });

  it("clearing a project's hotkey override sends null for that type, not a left-out entry", async () => {
    const { requests } = renderSection([{ method: "PUT", path: /\/projects\/[^/]+\/types$/, body: project }]);
    await screen.findByRole("button", { name: "Move Excavator down" });
    fireEvent.change(screen.getByLabelText("Hotkey of Excavator"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({
      type_ids: [TYPE_ID(1), TYPE_ID(3)],
      hotkeys: { [TYPE_ID(1)]: null },
    });
  });

  it("with the catalogue unavailable, hides the add field and a reorder keeps every override", async () => {
    const { requests } = renderSection(
      [{ method: "PUT", path: /\/projects\/[^/]+\/types$/, body: project }],
      TYPES_503,
    );
    expect(
      await screen.findByText("The catalogue is not available, so types cannot be added now."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Add type")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move Excavator down" }));
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PUT")).toBe(true));
    expect(requests.find((r) => r.method === "PUT")?.body).toEqual({
      type_ids: [TYPE_ID(3), TYPE_ID(1)],
      hotkeys: {},
    });
  });

  it("creates a type that is not in the catalogue yet, from the same field", async () => {
    const rust = {
      ...exampleTypes[2],
      id: "t-rust",
      name: "Rust",
      hotkey: null,
      group: null,
      default_severity: null,
    };
    const { requests } = renderSection([
      { method: "POST", path: /\/catalogue\/types$/, status: 201, body: rust },
    ]);
    await screen.findByRole("button", { name: "Move Excavator down" });
    fireEvent.change(screen.getByLabelText("Add type"), { target: { value: "Rust" } });
    fireEvent.click(screen.getByRole("button", { name: 'Create "Rust"' }));
    expect(await screen.findByRole("button", { name: "Move Rust up" })).toBeInTheDocument();
    expect(requests.find((r) => r.method === "POST")?.body).toMatchObject({ name: "Rust", kind: "defect" });
  });

  it("refuses a hotkey used twice before sending", async () => {
    const { requests } = renderSection([]);
    fireEvent.change(await screen.findByLabelText("Hotkey of Crack"), { target: { value: "9" } });
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    expect(
      screen.getByText('Hotkey 9 is used by "Excavator" and "Crack" in this project.'),
    ).toBeInTheDocument();
    expect(requests.some((r) => r.method === "PUT")).toBe(false);
  });

  it("explains a type that still has annotations", async () => {
    renderSection([
      {
        method: "PUT",
        path: /\/projects\/[^/]+\/types$/,
        status: 409,
        body: errorBody("class_in_use", "in use", { type_id: TYPE_ID(3), box_count: 4, finding_count: 1 }),
      },
    ]);
    fireEvent.click(await screen.findByRole("button", { name: "Remove Crack" }));
    fireEvent.click(screen.getByRole("button", { name: "Save types" }));
    expect(
      await screen.findByText(
        '"Crack" still has 4 annotations and 1 finding. Reassign or delete them before removing the type.',
      ),
    ).toBeInTheDocument();
  });
});
