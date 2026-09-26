import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { errorBody, fakeClient, PROJECT_ID, type RecordedRequest } from "@/test/fixtures";
import { baseRoutes, exampleFinding, exampleFinding2 } from "@/test/findingFixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { FindingsScreen } from "./FindingsScreen";

function renderTab(search = "", items = [exampleFinding, exampleFinding2], listStatus = 200) {
  const { api, requests } = fakeClient(
    baseRoutes([
      {
        method: "GET",
        path: /\/findings$/,
        status: listStatus,
        body: listStatus === 200 ? { items, next_cursor: null } : errorBody("internal", "Database locked"),
      },
    ]),
  );
  renderWithProviders(
    <>
      <FindingsScreen />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/findings${search}`, path: "/p/:projectId/findings/:findingId?" },
  );
  return requests;
}

const listRequests = (requests: RecordedRequest[]) =>
  requests.filter((r) => /\/findings\?/.test(r.url)).map((r) => new URL(r.url, "http://fake").searchParams);

describe("FindingsScreen", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0, dataRevision: 0 }));

  it("reads the filters from the URL and sends them", async () => {
    const requests = renderTab("?status=open&severity=4");
    await screen.findByText("F-0217");
    const q = listRequests(requests)[0];
    expect(q.getAll("status")).toEqual(["open"]);
    expect(q.getAll("severity")).toEqual(["4"]);
    expect(q.get("limit")).toBe("200");
  });

  it("shows number, type, severity, location and status per row", async () => {
    renderTab();
    const number = await screen.findByText("F-0217");
    const row = number.closest('[role="row"]') as HTMLElement;
    expect(within(row).getByText("Spalling")).toBeInTheDocument();
    expect(within(row).getByText("Critical")).toBeInTheDocument();
    expect(within(row).getByText("Flight 14 Sep")).toBeInTheDocument();
    expect(within(row).getByText("Open")).toBeInTheDocument();
    expect(screen.getByText("F-0218")).toBeInTheDocument();
  });

  it("writes a status choice into the URL and fetches that view", async () => {
    const requests = renderTab();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("radio", { name: /Reviewed/ }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("status=reviewed"));
    await waitFor(() => expect(listRequests(requests).at(-1)!.getAll("status")).toEqual(["reviewed"]));
  });

  it("toggles a severity and the No severity filter", async () => {
    renderTab();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Critical", pressed: false }));
    fireEvent.click(screen.getByRole("button", { name: "No severity", pressed: false }));
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("severity=4&severity=none"));
  });

  it("debounces the search into the URL", async () => {
    renderTab();
    await screen.findByText("F-0217");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search findings" }), {
      target: { value: "F-0217" },
    });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("q=F-0217"));
  });

  it("keeps a trailing space the user is still typing after the search lands in the URL", async () => {
    renderTab();
    await screen.findByText("F-0217");
    const box = screen.getByRole("searchbox", { name: "Search findings" });
    fireEvent.change(box, { target: { value: "crack " } });
    await waitFor(() => expect(screen.getByTestId("location")).toHaveTextContent("q=crack"));
    expect(box).toHaveValue("crack ");
  });

  it("clears every filter", async () => {
    renderTab("?severity=4&anchor_kind=map");
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/findings`),
    );
    expect(screen.getByTestId("location").textContent).not.toContain("?");
  });

  it("Clear while the search is still debouncing drops the typed text too", async () => {
    renderTab("?severity=4");
    await screen.findByText("F-0217");
    const box = screen.getByRole("searchbox", { name: "Search findings" });
    fireEvent.change(box, { target: { value: "crack" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    await act(() => new Promise((r) => setTimeout(r, 400)));
    expect(box).toHaveValue("");
    expect(screen.getByTestId("location").textContent).toBe(`/p/${PROJECT_ID}/findings`);
  });

  it("shows only the error when the first load fails", async () => {
    renderTab("", [], 500);
    expect(await screen.findByText("Database locked")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Nothing here yet")).toBeNull();
    expect(screen.queryByText("No findings yet")).toBeNull();
  });

  it("explains where findings come from when there are none", async () => {
    renderTab("", []);
    expect(await screen.findByText("No findings yet")).toBeInTheDocument();
  });

  it("offers Clear when filters hide everything", async () => {
    renderTab("?severity=1", []);
    expect(await screen.findByText("No findings match these filters")).toBeInTheDocument();
  });

  it("renders a finding whose type left the project as Unknown type", async () => {
    renderTab("", [{ ...exampleFinding, type_id: "gone" }]);
    expect(await screen.findByText("Unknown type")).toBeInTheDocument();
  });

  // F8: DataTable opens a row on a single click (or Enter); it has no double-click handler.
  it("opens a row in the inspector route, keeping the filters", async () => {
    renderTab("?status=open");
    fireEvent.click(await screen.findByText("F-0217"));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(
        `/p/${PROJECT_ID}/findings/${exampleFinding.id}?status=open`,
      ),
    );
  });
});
