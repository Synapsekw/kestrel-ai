import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { errorBody, exampleModel, fakeClient, IMAGE_ID, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import {
  baseRoutes,
  exampleFinding2,
  exampleFindingDetail,
  FINDING_ID,
  FINDING_ID_2,
  TYPE_CRACK,
} from "@/test/findingFixtures";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { useToastStore } from "@/ui";
import { FindingInspector, type FindingInspectorProps } from "./FindingInspector";
import { useInspectorCommands } from "./inspectorStore";

const detail = (patch: Partial<typeof exampleFindingDetail> = {}) => ({ ...exampleFindingDetail, ...patch });

function renderInspector(routes: FakeRoute[] = [], props: Partial<FindingInspectorProps> = {}) {
  const { api, requests } = fakeClient(
    baseRoutes([
      ...routes,
      {
        method: "PATCH",
        path: /\/findings\/[^/]+$/,
        body: (r) => ({ ...detail(), ...(r.body as object) }),
      },
      { method: "DELETE", path: /\/findings\/[^/]+$/, status: 204 },
      { method: "GET", path: /\/library\/models\/[^/]+$/, body: exampleModel },
      {
        method: "GET",
        path: /\/findings\/[^/]+\/(comments|attachments)$/,
        body: { items: [], next_cursor: null },
      },
      { method: "GET", path: /\/activity$/, body: { items: [], next_cursor: null } },
      { method: "GET", path: /\/findings\/[^/]+$/, body: detail() },
    ]),
  );
  renderWithProviders(
    <>
      <FindingInspector projectId={PROJECT_ID} findingId={FINDING_ID} {...props} />
      <LocationProbe />
    </>,
    { api, route: `/p/${PROJECT_ID}/findings/${FINDING_ID}`, path: "/p/:projectId/findings/:findingId?" },
  );
  return requests;
}

const patches = (requests: { method: string; body: unknown }[]) =>
  requests.filter((r) => r.method === "PATCH").map((r) => r.body);

describe("FindingInspector", () => {
  beforeEach(() => useChangesStore.setState({ findingsRevision: 0 }));

  it("shows the number, the type, AI provenance and the default anchor link", async () => {
    renderInspector();
    expect(await screen.findByText("F-0217")).toBeInTheDocument();
    expect(screen.getByText("Spalling")).toBeInTheDocument();
    expect(await screen.findByText(`Created by AI · ${exampleModel.name} · 87%`)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in workspace" })).toHaveAttribute(
      "href",
      `/p/${PROJECT_ID}/images/${IMAGE_ID}?finding=${FINDING_ID}`,
    );
  });

  it("falls back to the model id when the library no longer has it", async () => {
    renderInspector([
      {
        method: "GET",
        path: /\/library\/models\/[^/]+$/,
        status: 404,
        body: errorBody("not_found", "no such model"),
      },
    ]);
    expect(await screen.findByText(/Created by AI · Model m0000000 · 87%/)).toBeInTheDocument();
  });

  it("sets the severity", async () => {
    const requests = renderInspector();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("radio", { name: /Major/ }));
    await waitFor(() => expect(patches(requests)).toEqual([{ severity: 3 }]));
    expect(useChangesStore.getState().findingsRevision).toBeGreaterThan(0);
  });

  it("refuses closed → reviewed and explains why", async () => {
    const requests = renderInspector([
      { method: "GET", path: /\/findings\/[^/]+$/, body: detail({ status: "closed" }) },
    ]);
    await screen.findByText("F-0217");
    expect(screen.getByRole("radio", { name: "Reviewed" })).toBeDisabled();
    expect(screen.getByText("Reopen a closed finding before marking it reviewed.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Open" }));
    await waitFor(() => expect(patches(requests)).toEqual([{ status: "open" }]));
  });

  it("reverts and says so when the server refuses a change", async () => {
    renderInspector([
      {
        method: "PATCH",
        path: /\/findings\/[^/]+$/,
        status: 409,
        body: errorBody("invalid_transition", "closed findings must be reopened first"),
      },
    ]);
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("radio", { name: "Closed" }));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: "Open" })).toHaveAttribute("aria-checked", "true"),
    );
  });

  it("changes the type through the picker, and T opens it", async () => {
    const requests = renderInspector();
    await screen.findByText("F-0217");
    act(() => useInspectorCommands.getState().openTypePicker());
    fireEvent.click(await screen.findByRole("option", { name: /Crack/ }));
    await waitFor(() => expect(patches(requests)).toEqual([{ type_id: TYPE_CRACK }]));
  });

  it("renders the host's slots", async () => {
    renderInspector([], {
      anchorSlot: <button type="button">Show on image</button>,
      measureSlot: <p>0.084 m²</p>,
    });
    expect(await screen.findByText("0.084 m²")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show on image" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in workspace" })).toBeNull();
  });

  it("deletes after confirming and hands null to the host", async () => {
    const onNavigate = vi.fn();
    const requests = renderInspector([], { onNavigate });
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Finding actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    expect(screen.getByText(/Its box on the image is deleted too/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete F-0217" }));
    await waitFor(() => expect(onNavigate).toHaveBeenCalledWith(null));
    expect(requests.some((r) => r.method === "DELETE")).toBe(true);
  });

  it("without a host, a delete returns to the Findings tab", async () => {
    renderInspector();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Finding actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete F-0217" }));
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/findings`),
    );
    expect(screen.getByTestId("location").textContent).toBe(`/p/${PROJECT_ID}/findings`);
  });

  it("copies the canonical link", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderInspector();
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("button", { name: "Finding actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`/p/${PROJECT_ID}/findings/${FINDING_ID}`));
  });
});

/** A PATCH that waits for `release()`, then answers from the fake routes or fails. */
function gatePatches(api: ReturnType<typeof fakeClient>["api"], gated: number[]) {
  const releases: Array<() => void> = [];
  // openapi-fetch's PATCH is overloaded per path; the gate only forwards its arguments.
  const real = api.PATCH.bind(api) as unknown as (...args: unknown[]) => Promise<unknown>;
  let call = 0;
  vi.spyOn(api, "PATCH").mockImplementation(((...args: unknown[]) => {
    call += 1;
    if (!gated.includes(call)) return real(...args);
    return new Promise<void>((resolve) => releases.push(resolve)).then(() => real(...args));
  }) as unknown as typeof api.PATCH);
  return releases;
}

/** The PATCH has settled: a saved one bumps the findings revision, a refused one raises a toast. */
function toastsOrRevision(status: number): boolean {
  return status === 200
    ? useChangesStore.getState().findingsRevision > 0
    : useToastStore.getState().toasts.some((t) => t.tone === "danger");
}

function SwitchingHost({ projectId }: { projectId: string }) {
  const [id, setId] = useState(FINDING_ID);
  return (
    <>
      <button type="button" onClick={() => setId(FINDING_ID_2)}>
        Next finding
      </button>
      <FindingInspector key="one-inspector" projectId={projectId} findingId={id} />
    </>
  );
}

describe("FindingInspector while switching findings", () => {
  beforeEach(() => {
    useChangesStore.setState({ findingsRevision: 0 });
    useToastStore.getState().clear();
  });

  it.each([
    ["saved", 200],
    ["refused", 409],
  ])("a PATCH %s after the switch leaves the next finding on screen", async (_, status) => {
    const { api, requests } = fakeClient(
      baseRoutes([
        {
          method: "PATCH",
          path: /\/findings\/[^/]+$/,
          status,
          body: (r) =>
            status === 200
              ? { ...detail(), ...(r.body as object) }
              : errorBody("invalid_transition", "closed findings must be reopened first"),
        },
        { method: "GET", path: /\/library\/models\/[^/]+$/, body: exampleModel },
        {
          method: "GET",
          path: /\/findings\/[^/]+$/,
          body: (r) =>
            r.url.includes(FINDING_ID_2)
              ? { ...exampleFinding2, attachment_count: 0, comment_count: 0 }
              : detail(),
        },
      ]),
    );
    const releases = gatePatches(api, [1]);
    renderWithProviders(<SwitchingHost projectId={PROJECT_ID} />, { api });
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("radio", { name: /Major/ }));
    await waitFor(() => expect(releases).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Next finding" }));
    expect(await screen.findByText("F-0218")).toBeInTheDocument();
    // Records any skeleton flash on B from here on (a revert or a saved answer landing on B).
    let flashed = false;
    const watch = new MutationObserver(() => {
      if (document.querySelector('[role="status"][aria-label="Loading"]')) flashed = true;
    });
    watch.observe(document.body, { childList: true, subtree: true });
    act(() => releases[0]());
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    await waitFor(() => expect(toastsOrRevision(status)).toBe(true));
    watch.disconnect();
    expect(flashed).toBe(false);
    expect(screen.getByText("F-0218")).toBeInTheDocument();
    expect(screen.queryByText("F-0217")).toBeNull();
    expect(screen.queryByRole("status", { name: /Loading/ })).toBeNull();
    expect(screen.getByRole("radio", { name: "None" })).toHaveAttribute("aria-checked", "true");
  });

  it("a refused first edit does not revert a newer one", async () => {
    let n = 0;
    const { api } = fakeClient(
      baseRoutes([
        {
          method: "PATCH",
          path: /\/findings\/[^/]+$/,
          status: () => (++n === 2 ? 409 : 200),
          body: (r) =>
            n === 2 ? errorBody("validation_error", "nope") : { ...detail(), ...(r.body as object) },
        },
        { method: "GET", path: /\/library\/models\/[^/]+$/, body: exampleModel },
        {
          method: "GET",
          path: /\/findings\/[^/]+$/,
          body: () => ({ ...detail(), severity: n ? 1 : 4 }),
        },
      ]),
    );
    const releases = gatePatches(api, [1]);
    renderWithProviders(<FindingInspector projectId={PROJECT_ID} findingId={FINDING_ID} />, { api });
    await screen.findByText("F-0217");
    fireEvent.click(screen.getByRole("radio", { name: /Major/ }));
    await waitFor(() => expect(releases).toHaveLength(1));
    fireEvent.click(screen.getByRole("radio", { name: /Minor/ }));
    await waitFor(() => expect(n).toBe(1));
    act(() => releases[0]());
    await waitFor(() => expect(n).toBe(2));
    await waitFor(() =>
      expect(screen.getByRole("radio", { name: /Minor/ })).toHaveAttribute("aria-checked", "true"),
    );
  });
});
