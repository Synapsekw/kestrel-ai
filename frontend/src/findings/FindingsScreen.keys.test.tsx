import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import { baseRoutes, exampleFinding, exampleFinding2, exampleFindingDetail } from "@/test/findingFixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { applyBulk, bulkMessage } from "./bulk";
import { FindingsScreen } from "./FindingsScreen";
import { useInspectorCommands } from "./inspectorStore";

function renderTab(path = "") {
  const { api, requests } = fakeClient(
    baseRoutes([
      {
        method: "POST",
        path: /\/findings\/bulk$/,
        body: (r) => ({ updated: (r.body as { ids: string[] }).ids.length, skipped: [] }),
      },
      {
        method: "GET",
        path: /\/findings$/,
        body: { items: [exampleFinding, exampleFinding2], next_cursor: null },
      },
      {
        method: "GET",
        path: /\/findings\/[^/]+\/(comments|attachments)$/,
        body: { items: [], next_cursor: null },
      },
      { method: "GET", path: /\/activity$/, body: { items: [], next_cursor: null } },
      {
        method: "GET",
        path: /\/library\/models\/[^/]+$/,
        status: 404,
        body: { error: { code: "not_found", message: "x", details: {} } },
      },
      { method: "PATCH", path: /\/findings\/[^/]+$/, body: exampleFindingDetail },
      { method: "DELETE", path: /\/findings\/[^/]+$/, status: 204 },
      { method: "GET", path: /\/findings\/(?!summary$)[^/]+$/, body: exampleFindingDetail },
    ]),
  );
  renderWithProviders(
    <>
      <FindingsScreen />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/findings${path}`, path: "/p/:projectId/findings/:findingId?" },
  );
  return requests;
}

const bulkBodies = (requests: RecordedRequest[]) =>
  requests.filter((r) => r.url.includes("/bulk")).map((r) => r.body);
const key = (k: string, init: KeyboardEventInit = {}) => fireEvent.keyDown(window, { key: k, ...init });
const settle = () => act(() => new Promise((r) => setTimeout(r, 50)));
const location = () => screen.getByTestId("location");

describe("Findings tab keys and bulk", () => {
  beforeEach(() => {
    useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 });
    useInspectorCommands.setState({ typePickerNonce: 0 });
  });

  it("opens the inspector for the finding in the URL", async () => {
    renderTab(`/${exampleFinding.id}`);
    expect(await screen.findByText("Selected finding")).toBeInTheDocument();
  });

  it("grades the open finding with a digit and ignores digits beyond the scale", async () => {
    const requests = renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    key("7");
    key("3");
    await waitFor(() =>
      expect(bulkBodies(requests)).toEqual([{ ids: [exampleFinding.id], set: { severity: 3 } }]),
    );
  });

  // Review Focus 2: keys never fire from a text field. The positive control proves the same key on
  // window does reach the handler, so the negative half can fail.
  it("typing digits in the search field sets no severity", async () => {
    const requests = renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    const search = screen.getByRole("searchbox", { name: "Search findings" });
    fireEvent.keyDown(search, { key: "3" });
    fireEvent.keyDown(search, { key: "C", shiftKey: true });
    fireEvent.keyDown(search, { key: "t" });
    await settle();
    expect(bulkBodies(requests)).toEqual([]);
    expect(useInspectorCommands.getState().typePickerNonce).toBe(0);
    key("3");
    await waitFor(() => expect(bulkBodies(requests)).toHaveLength(1));
    await settle();
    expect(bulkBodies(requests)).toEqual([{ ids: [exampleFinding.id], set: { severity: 3 } }]);
  });

  it("typing a note with a digit saves the note and sets no severity", async () => {
    const requests = renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    const note = await screen.findByRole("textbox", { name: "Note" });
    for (const ch of "crack 3") fireEvent.keyDown(note, { key: ch });
    fireEvent.change(note, { target: { value: "crack 3" } });
    const patches = () => requests.filter((r) => r.method === "PATCH").map((r) => r.body);
    await waitFor(() => expect(patches()).toEqual([{ note: "crack 3" }]), { timeout: 2000 });
    expect(bulkBodies(requests)).toEqual([]);
  });

  it("sets the status with Shift+O / Shift+R / Shift+C", async () => {
    const requests = renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    key("C", { shiftKey: true });
    await waitFor(() =>
      expect(bulkBodies(requests)).toEqual([{ ids: [exampleFinding.id], set: { status: "closed" } }]),
    );
  });

  it("applies a key to the checked rows rather than the open finding", async () => {
    const requests = renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    // A clicked checkbox keeps focus in the webview; the key must still reach the checked rows.
    const boxes = screen.getAllByRole("checkbox", { name: /^Select row/ });
    for (const box of boxes) {
      fireEvent.click(box);
      box.focus();
    }
    expect(document.activeElement).toBe(boxes[1]);
    fireEvent.keyDown(boxes[1], { key: "R", shiftKey: true });
    await waitFor(() =>
      expect(bulkBodies(requests)).toEqual([
        { ids: [exampleFinding.id, exampleFinding2.id], set: { status: "reviewed" } },
      ]),
    );
  });

  it("T asks the inspector for its type picker", async () => {
    renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    key("t");
    expect(useInspectorCommands.getState().typePickerNonce).toBe(1);
  });

  it("J and K open the next and previous finding, keeping the filters", async () => {
    renderTab(`/${exampleFinding.id}?status=open`);
    await screen.findByText("Selected finding");
    key("j");
    await waitFor(() =>
      expect(location()).toHaveTextContent(`/p/${PROJECT_ID}/findings/${exampleFinding2.id}?status=open`),
    );
    key("j");
    await settle();
    expect(location()).toHaveTextContent(exampleFinding2.id);
    key("k");
    await waitFor(() => expect(location()).toHaveTextContent(`/findings/${exampleFinding.id}?status=open`));
  });

  it("Esc closes the inspector and keeps the filters", async () => {
    renderTab(`/${exampleFinding.id}?status=open`);
    await screen.findByText("Selected finding");
    key("Escape");
    await waitFor(() => expect(location()).toHaveTextContent(`/p/${PROJECT_ID}/findings?status=open`));
  });

  it("Esc inside a menu closes the menu, not the inspector", async () => {
    renderTab(`/${exampleFinding.id}`);
    await screen.findByText("Selected finding");
    fireEvent.click(screen.getByRole("button", { name: "Finding actions" }));
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(within(menu).getAllByRole("menuitem")[0], { key: "Escape" });
    await settle();
    expect(location()).toHaveTextContent(`/findings/${exampleFinding.id}`);
  });

  it("closes the inspector after the finding is deleted", async () => {
    renderTab(`/${exampleFinding.id}?status=open`);
    await screen.findByText("Selected finding");
    fireEvent.click(screen.getByRole("button", { name: "Finding actions" }));
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete F-0217" }));
    await waitFor(() => expect(location()).toHaveTextContent(`/p/${PROJECT_ID}/findings?status=open`));
    await settle();
    expect(screen.queryByText("Selected finding")).toBeNull();
  });

  it("closes every checked row from the bulk bar", async () => {
    const requests = renderTab();
    await screen.findByText("F-0217");
    for (const box of screen.getAllByRole("checkbox", { name: /^Select row/ })) fireEvent.click(box);
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set status" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Closed" }));
    await waitFor(() =>
      expect(bulkBodies(requests)).toEqual([
        { ids: [exampleFinding.id, exampleFinding2.id], set: { status: "closed" } },
      ]),
    );
    await waitFor(() => expect(screen.queryByText("2 selected")).toBeNull());
  });

  it("Esc clears the checked rows when no inspector is open", async () => {
    renderTab();
    await screen.findByText("F-0217");
    const box = screen.getAllByRole("checkbox", { name: /^Select row/ })[0];
    fireEvent.click(box);
    box.focus();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    fireEvent.keyDown(box, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText("1 selected")).toBeNull());
  });
});

describe("bulk helpers", () => {
  it("splits more than 1000 ids into several requests", async () => {
    const { api, requests } = fakeClient([
      {
        method: "POST",
        path: /\/findings\/bulk$/,
        body: (r) => ({ updated: (r.body as { ids: string[] }).ids.length, skipped: [] }),
      },
    ]);
    const ids = Array.from({ length: 2345 }, (_, i) => `f-${i}`);
    const result = await applyBulk(api, PROJECT_ID, ids, { status: "closed" });
    expect(requests.map((r) => (r.body as { ids: string[] }).ids.length)).toEqual([1000, 1000, 345]);
    expect(result.updated).toBe(2345);
  });

  it("explains skipped findings", () => {
    expect(bulkMessage(3, [], "Closed")).toBe("3 findings set to Closed.");
    expect(bulkMessage(1, [], "Critical")).toBe("1 finding set to Critical.");
    expect(bulkMessage(2, [{ id: "a", code: "invalid_transition" }], "Reviewed")).toBe(
      "2 findings set to Reviewed. 1 skipped: a closed finding has to be reopened first.",
    );
  });
});
