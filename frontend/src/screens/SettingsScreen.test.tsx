import { describe, it, expect } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useNavigate } from "react-router-dom";
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

const OTHER_PROJECT_ID = "7f1c2e3a-2222-4000-8000-000000000002";

/** Switches the route to another project, so the same SettingsScreen instance is reused. */
function OpenOtherProject() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/p/${OTHER_PROJECT_ID}/settings`)}>
      Open other project
    </button>
  );
}

function renderSettings(routes: FakeRoute[]) {
  const { api, requests } = fakeClient([
    // First, so a test's own route for one project wins over the catch-all project read below.
    ...routes,
    { method: "GET", path: /\/projects\/[^/]+$/, body: project },
    ...BACKDROP,
  ]);
  renderWithProviders(
    <>
      <SettingsScreen />
      <OpenOtherProject />
    </>,
    {
      api,
      route: `/p/${PROJECT_ID}/settings`,
      path: "/p/:projectId/settings",
    },
  );
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

  it('drops the "Types saved" status when the route switches to another project', async () => {
    const other = { ...project, id: OTHER_PROJECT_ID, name: "Other site" };
    const { requests } = renderSettings([
      { method: "PUT", path: /\/projects\/[^/]+\/types$/, body: project },
      { method: "GET", path: new RegExp(`/projects/${OTHER_PROJECT_ID}$`), body: other },
    ]);

    const types = await screen.findByRole("region", { name: "Types" });
    fireEvent.change(within(types).getByLabelText("Add type"), { target: { value: "dump" } });
    fireEvent.click(await within(types).findByRole("button", { name: "Add Dump truck" }));
    fireEvent.click(within(types).getByRole("button", { name: "Save types" }));
    expect(await within(types).findByText("Types saved")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open other project" }));
    await waitFor(() => {
      expect(requests.some((r) => r.url.endsWith(`/projects/${OTHER_PROJECT_ID}`))).toBe(true);
      const types2 = screen.getByRole("region", { name: "Types" });
      expect(within(types2).queryByText("Types saved")).not.toBeInTheDocument();
    });
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
