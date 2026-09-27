import { describe, it, expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { exampleProject, fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { exampleCataloguePage, exampleProjectClasses, TYPE_ID } from "@/test/appSectionFixtures";
import { renderWithProviders } from "@/test/render";
import { SettingsScreen } from "./SettingsScreen";

const project = { ...exampleProject, classes: exampleProjectClasses };

/** Every route the other sections on the screen need just to mount; the tests below add their own. */
const BACKDROP: FakeRoute[] = [
  { method: "GET", path: /\/catalogue\/types$/, body: exampleCataloguePage },
  { method: "GET", path: /\/library\/models$/, body: { items: [], next_cursor: null } },
  { method: "GET", path: /\/sources$/, body: { items: [], next_cursor: null } },
  { method: "GET", path: /\/providers$/, body: { items: [] } },
];

function renderSettings(routes: FakeRoute[]) {
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+$/, body: project },
    ...BACKDROP,
    ...routes,
  ]);
  renderWithProviders(<SettingsScreen />, {
    api,
    route: `/p/${PROJECT_ID}/settings`,
    path: "/p/:projectId/settings",
  });
  return { requests };
}

describe("SettingsScreen", () => {
  it('shows "Types saved" after the save that changes the project\'s type list', async () => {
    const dumpTruck = {
      id: TYPE_ID(2),
      name: "Dump truck",
      colour: "#06b6d4",
      hotkey: null,
      order: 2,
      kind: "object",
      default_severity: null,
      group: null,
    };
    const saved = { ...project, classes: [...exampleProjectClasses, dumpTruck] };
    renderSettings([{ method: "PUT", path: /\/projects\/[^/]+\/types$/, body: saved }]);

    const types = await screen.findByRole("region", { name: "Types" });
    fireEvent.change(within(types).getByLabelText("Add type"), { target: { value: "dump" } });
    fireEvent.click(await within(types).findByRole("button", { name: "Add Dump truck" }));
    fireEvent.click(within(types).getByRole("button", { name: "Save types" }));

    // The save resolves and changes `project.classes`; the status must still be on screen after.
    expect(await within(types).findByText("Types saved")).toBeInTheDocument();
    // And the draft still reset to the saved list, not left showing the pre-save edit forever.
    await waitFor(() => expect(within(types).getByRole("button", { name: "Save types" })).toBeDisabled());
  });

  it('shows "Import defaults saved" after the save that changes the import defaults', async () => {
    const saved = { ...project, import_defaults: { ...project.import_defaults, max_side: 3000 } };
    renderSettings([{ method: "PATCH", path: /\/projects\/[^/]+$/, body: saved }]);

    await screen.findByLabelText("Max side");
    fireEvent.change(screen.getByLabelText("Max side"), { target: { value: "3000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save import defaults" }));

    expect(await screen.findByText("Import defaults saved")).toBeInTheDocument();
  });
});
