import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  errorBody,
  exampleModel,
  fakeClient,
  PROJECT_ID,
  type FakeRoute,
  type RecordedRequest,
} from "@/test/fixtures";
import {
  baseRoutes,
  exampleActivity,
  exampleAttachment,
  exampleComment,
  exampleFindingDetail,
  FINDING_ID,
  FINDING_ID_2,
} from "@/test/findingFixtures";
import { renderWithProviders, TestApiProvider } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useToastStore } from "@/ui";
import { MemoryRouter } from "react-router-dom";
import { FindingInspector } from "./FindingInspector";
import { NoteField } from "./inspector/NoteField";

const routes = (extra: FakeRoute[] = []): FakeRoute[] =>
  baseRoutes([
    ...extra,
    { method: "GET", path: /\/library\/models\/[^/]+$/, body: exampleModel },
    { method: "GET", path: /\/comments$/, body: { items: [exampleComment], next_cursor: null } },
    {
      method: "POST",
      path: /\/comments$/,
      status: 201,
      body: (r) => ({ ...exampleComment, id: "c2", text: (r.body as { text: string }).text }),
    },
    {
      method: "PATCH",
      path: /\/comments\/[^/]+$/,
      body: (r) => ({
        ...exampleComment,
        text: (r.body as { text: string }).text,
        edited_at: "2026-09-26T10:00:00Z",
      }),
    },
    { method: "DELETE", path: /\/comments\/[^/]+$/, status: 204 },
    { method: "GET", path: /\/attachments$/, body: { items: [exampleAttachment] } },
    { method: "POST", path: /\/attachments$/, status: 201, body: exampleAttachment },
    { method: "GET", path: /\/activity$/, body: { items: exampleActivity, next_cursor: null } },
    { method: "PATCH", path: /\/findings\/[^/]+$/, body: exampleFindingDetail },
    { method: "GET", path: /\/findings\/[^/]+$/, body: exampleFindingDetail },
  ]);

function renderInspector(extra: FakeRoute[] = []) {
  const { api, requests } = fakeClient(routes(extra));
  renderWithProviders(<FindingInspector projectId={PROJECT_ID} findingId={FINDING_ID} />, { api });
  return requests;
}

const bodies = (requests: RecordedRequest[], method: string, re: RegExp) =>
  requests.filter((r) => r.method === method && re.test(r.url)).map((r) => r.body);

describe("inspector note", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    useChangesStore.setState({ findingsRevision: 0 });
    useToastStore.setState({ toasts: [] });
  });
  afterEach(() => vi.useRealTimers());

  it("saves once, 600 ms after the last keystroke, then says Saved", async () => {
    const requests = renderInspector();
    const note = await screen.findByRole("textbox", { name: "Note" });
    // Strict fake timers from here: only the test moves the clock, so a stalled runner cannot fire
    // the 600 ms autosave before the "not yet at 599 ms" check.
    vi.useRealTimers();
    vi.useFakeTimers();
    fireEvent.change(note, { target: { value: "crack 3" } });
    fireEvent.change(note, { target: { value: "crack 3 mm" } });
    await act(() => vi.advanceTimersByTimeAsync(599));
    expect(bodies(requests, "PATCH", /\/findings\/[^/]+$/)).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(1));
    vi.useRealTimers();
    await waitFor(() =>
      expect(bodies(requests, "PATCH", /\/findings\/[^/]+$/)).toEqual([{ note: "crack 3 mm" }]),
    );
    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("flushes an unsaved note to its own finding when the inspector switches", async () => {
    const { api, requests } = fakeClient(routes());
    const view = (findingId: string) => (
      <TestApiProvider api={api}>
        <MemoryRouter>
          <NoteField key={findingId} projectId={PROJECT_ID} findingId={findingId} initial="" />
        </MemoryRouter>
      </TestApiProvider>
    );
    const { rerender } = render(view(FINDING_ID));
    fireEvent.change(screen.getByRole("textbox", { name: "Note" }), { target: { value: "for 217" } });
    rerender(view(FINDING_ID_2));
    await waitFor(() => expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1));
    const patch = requests.find((r) => r.method === "PATCH")!;
    expect(patch.url).toContain(`/findings/${FINDING_ID}`);
    expect(patch.body).toEqual({ note: "for 217" });
    // The new finding's field is empty and saves nothing, even after the debounce window.
    expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue("");
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    expect(requests.filter((r) => r.method === "PATCH")).toHaveLength(1);
  });

  it("keeps a note typed on one finding off the next when the whole inspector switches", async () => {
    const second = { ...exampleFindingDetail, id: FINDING_ID_2, number: 218, note: "" };
    const { api, requests } = fakeClient(
      routes([{ method: "GET", path: new RegExp(`/findings/${FINDING_ID_2}$`), body: second }]),
    );
    const view = (findingId: string) => (
      <TestApiProvider api={api}>
        <MemoryRouter>
          <FindingInspector projectId={PROJECT_ID} findingId={findingId} />
        </MemoryRouter>
      </TestApiProvider>
    );
    const { rerender } = render(view(FINDING_ID));
    fireEvent.change(await screen.findByRole("textbox", { name: "Note" }), { target: { value: "for 217" } });
    rerender(view(FINDING_ID_2));
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Note" })).toHaveValue(""));
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    const patches = requests.filter((r) => r.method === "PATCH");
    expect(patches.map((r) => [r.url.split("/findings/")[1], r.body])).toEqual([
      [FINDING_ID, { note: "for 217" }],
    ]);
  });
  it("says so in a toast when the flush on switch fails", async () => {
    const second = { ...exampleFindingDetail, id: FINDING_ID_2, number: 218, note: "" };
    const { api, requests } = fakeClient(
      routes([
        { method: "GET", path: new RegExp(`/findings/${FINDING_ID_2}$`), body: second },
        {
          method: "PATCH",
          path: new RegExp(`/findings/${FINDING_ID}$`),
          status: 500,
          body: errorBody("internal", "database is locked"),
        },
      ]),
    );
    const view = (findingId: string) => (
      <TestApiProvider api={api}>
        <MemoryRouter>
          <FindingInspector projectId={PROJECT_ID} findingId={findingId} />
        </MemoryRouter>
      </TestApiProvider>
    );
    const { rerender } = render(view(FINDING_ID));
    fireEvent.change(await screen.findByRole("textbox", { name: "Note" }), { target: { value: "for 217" } });
    rerender(view(FINDING_ID_2));
    await waitFor(() =>
      expect(useToastStore.getState().toasts).toEqual([
        expect.objectContaining({ tone: "danger", text: "Note on F-0217 was not saved: database is locked" }),
      ]),
    );
    expect(requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([{ note: "for 217" }]);
  });
});

describe("inspector photos, comments and history", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0 }));

  it("adds a photo by path in the browser and shows the refusal reason", async () => {
    const requests = renderInspector([
      {
        method: "POST",
        path: /\/attachments$/,
        status: 422,
        body: errorBody("attachment_invalid", "not an image: notes.txt"),
      },
    ]);
    expect(await screen.findByRole("button", { name: "View site-photo.jpg" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Photo file"), { target: { value: "E:/notes.txt" } });
    fireEvent.click(screen.getByRole("button", { name: "Add photo" }));
    expect(await screen.findByText("This photo was not added: not an image: notes.txt")).toBeInTheDocument();
    expect(bodies(requests, "POST", /\/attachments$/)).toEqual([{ path: "E:/notes.txt" }]);
  });

  it("opens a photo in the lightbox", async () => {
    renderInspector();
    fireEvent.click(await screen.findByRole("button", { name: "View site-photo.jpg" }));
    const dialog = await screen.findByRole("dialog", { name: "site-photo.jpg" });
    expect(dialog.querySelector("img")?.getAttribute("src")).toContain(
      `/attachments/${exampleAttachment.id}/file?token=`,
    );
  });

  it("shows the comment author the server sent", async () => {
    renderInspector([
      {
        method: "GET",
        path: /\/comments$/,
        body: { items: [{ ...exampleComment, author: "Site lead" }], next_cursor: null },
      },
    ]);
    expect(await screen.findByText("Site lead")).toBeInTheDocument();
  });

  it("replies with Enter; Shift+Enter keeps a new line", async () => {
    const requests = renderInspector();
    expect(await screen.findByText(exampleComment.text)).toBeInTheDocument();
    const reply = screen.getByRole("textbox", { name: "Reply" });
    fireEvent.change(reply, { target: { value: "Patched" } });
    fireEvent.keyDown(reply, { key: "Enter", shiftKey: true });
    expect(bodies(requests, "POST", /\/comments$/)).toEqual([]);
    fireEvent.keyDown(reply, { key: "Enter" });
    await waitFor(() => expect(bodies(requests, "POST", /\/comments$/)).toEqual([{ text: "Patched" }]));
    expect(await screen.findByText("Patched")).toBeInTheDocument();
  });

  it("posts a reply once when Enter is pressed twice before the first send returns", async () => {
    const requests = renderInspector();
    expect(await screen.findByText(exampleComment.text)).toBeInTheDocument();
    const reply = screen.getByRole("textbox", { name: "Reply" });
    fireEvent.change(reply, { target: { value: "Patched" } });
    fireEvent.keyDown(reply, { key: "Enter" });
    fireEvent.keyDown(reply, { key: "Enter" });
    expect(await screen.findByText("Patched")).toBeInTheDocument();
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(bodies(requests, "POST", /\/comments$/)).toEqual([{ text: "Patched" }]);
  });

  it("edits and deletes a comment", async () => {
    const requests = renderInspector();
    await screen.findByText(exampleComment.text);
    fireEvent.click(screen.getByRole("button", { name: "Edit comment" }));
    const box = screen.getByRole("textbox", { name: "Edit comment" });
    fireEvent.change(box, { target: { value: "Depth 30 mm." } });
    fireEvent.keyDown(box, { key: "Enter" });
    // The edit box mirrors its value as text in jsdom; the saved comment is the paragraph.
    expect(await screen.findByText("Depth 30 mm.", { selector: "p" })).toBeInTheDocument();
    expect(screen.getByText("(edited)")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete comment" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "DELETE" && r.url.includes("/comments/"))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByText("Depth 30 mm.")).not.toBeInTheDocument());
  });

  it("lists the finding's history from the activity feed", async () => {
    const requests = renderInspector();
    expect(await screen.findByText("F-0217 set to Critical")).toBeInTheDocument();
    const q = new URL(requests.find((r) => r.url.includes("/activity"))!.url, "http://fake").searchParams;
    expect(q.get("subject_id")).toBe(FINDING_ID);
    expect(q.get("limit")).toBe("20");
  });
});
