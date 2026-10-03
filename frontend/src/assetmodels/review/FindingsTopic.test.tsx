// src/assetmodels/review/FindingsTopic.test.tsx
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import type { ModelViewerHandle } from "@/assetmodels/viewer/ModelViewer";
import { LocationProbe, renderWithProviders } from "@/test/render";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { ASSET_FINDINGS, MODEL_REVIEWED, PLACEMENTS } from "@/test/assetFindingFixtures";
import { FindingsTopic } from "./FindingsTopic";
import { useFindingsLayer } from "./useFindingsLayer";

function handle() {
  return { setPlacements: vi.fn(), focusFinding: vi.fn(() => true) } as unknown as ModelViewerHandle &
    Record<"setPlacements" | "focusFinding", ReturnType<typeof vi.fn>>;
}

const actions = () => ({
  running: { pose: false, place: false, group: false },
  estimate: vi.fn(),
  compute: vi.fn(),
  regroup: vi.fn(),
});

function Harness({ h, a = actions() }: { h: ModelViewerHandle; a?: ReturnType<typeof actions> }) {
  const viewer = useRef<ModelViewerHandle | null>(h);
  const layer = useFindingsLayer({ projectId: PROJECT_ID, model: MODEL_REVIEWED, viewer });
  return (
    <>
      <FindingsTopic projectId={PROJECT_ID} model={MODEL_REVIEWED} layer={layer} actions={a} />
      <LocationProbe />
    </>
  );
}

const routes = () => [
  { method: "GET", path: /\/findings$/, body: { items: ASSET_FINDINGS, next_cursor: null } },
  { method: "GET", path: /\/placements$/, body: PLACEMENTS },
];

describe("FindingsTopic", () => {
  it("lists the model's findings with zone, side and height and sends the placements to the view", async () => {
    const { api, requests } = fakeClient(routes() as never);
    const h = handle();
    renderWithProviders(<Harness h={h} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    const list = await screen.findByRole("listbox", { name: /findings/i });
    expect(within(list).getByRole("option", { name: /F-0042/ })).toHaveTextContent("Middle · West · 12.4 m");
    expect(within(list).getByRole("option", { name: /F-0043/ })).toHaveTextContent("Not placed");
    expect(requests.find((r) => r.url.includes("/findings"))!.url).toContain("asset_model_id=m1");
    await waitFor(() => expect(h.setPlacements.mock.calls.at(-1)?.[0]).toHaveLength(2));
  });

  it("filters on the server and narrows the placements in the view to the listed findings", async () => {
    const { api, requests } = fakeClient([
      {
        method: "GET",
        path: /\/findings$/,
        body: (r: { url: string }) => ({
          items: r.url.includes("zone=podium") ? [] : ASSET_FINDINGS,
          next_cursor: null,
        }),
      },
      { method: "GET", path: /\/placements$/, body: PLACEMENTS },
    ] as never);
    const h = handle();
    renderWithProviders(<Harness h={h} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    await screen.findByRole("option", { name: /F-0042/ });
    fireEvent.change(screen.getByLabelText(/zone/i), { target: { value: "podium" } });
    await waitFor(() => expect(requests.some((r) => r.url.includes("zone=podium"))).toBe(true));
    await waitFor(() => expect(h.setPlacements.mock.calls.at(-1)?.[0]).toEqual([]));
    expect(await screen.findByText(/no findings match/i)).toBeInTheDocument();
  });

  it("focuses the selected finding with the profile's focus settings and opens its inspection", async () => {
    const { api } = fakeClient(routes() as never);
    const h = handle();
    renderWithProviders(<Harness h={h} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    fireEvent.click(await screen.findByRole("option", { name: /F-0042/ }));
    fireEvent.click(screen.getByRole("button", { name: /^focus$/i }));
    expect(h.focusFinding).toHaveBeenCalledWith("f1", { frustum: [0.05, 0.125], oblique_deg: 20 });
    fireEvent.click(screen.getByRole("link", { name: /inspect/i }));
    expect(screen.getByTestId("location")).toHaveTextContent(`/p/${PROJECT_ID}/models/m1/inspect?finding=f1`);
  });

  it("asks before Regroup and starts Compute placements from the menu", async () => {
    const { api } = fakeClient(routes() as never);
    const a = actions();
    renderWithProviders(<Harness h={handle()} a={a} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    await screen.findByRole("option", { name: /F-0042/ });
    fireEvent.click(screen.getByRole("button", { name: /findings actions/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /^compute placements$/i }));
    expect(a.compute).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: /findings actions/i }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /regroup findings/i }));
    const dialog = await screen.findByRole("dialog", { name: /regroup findings/i });
    expect(dialog).toHaveTextContent(/keep their number, status, notes and comments/i);
    fireEvent.click(within(dialog).getByRole("button", { name: /^regroup$/i }));
    expect(a.regroup).toHaveBeenCalled();
  });

  it("sends the placements once after the last page, not once per page", async () => {
    let pages = 0;
    const { api } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: ASSET_FINDINGS, next_cursor: null } },
      {
        method: "GET",
        path: /\/placements$/,
        body: () => {
          pages += 1;
          return pages === 1
            ? { ...PLACEMENTS, items: PLACEMENTS.items.slice(0, 1), next: "p2" }
            : { ...PLACEMENTS, items: PLACEMENTS.items.slice(1), next: null };
        },
      },
    ] as never);
    const h = handle();
    renderWithProviders(<Harness h={h} />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    await waitFor(() => expect(h.setPlacements).toHaveBeenCalled());
    expect(pages).toBe(2);
    expect(h.setPlacements).toHaveBeenCalledTimes(1);
    expect(h.setPlacements.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("sends the placements again when a reload moves a centre under the same ids", async () => {
    let loads = 0;
    const { api } = fakeClient([
      { method: "GET", path: /\/findings$/, body: { items: ASSET_FINDINGS, next_cursor: null } },
      {
        method: "GET",
        path: /\/placements$/,
        body: () => {
          loads += 1;
          const moved = loads > 1;
          return {
            ...PLACEMENTS,
            items: PLACEMENTS.items.map((p) => ({ ...p, center: moved ? [11, 12.4, -3] : p.center })),
          };
        },
      },
    ] as never);
    const h = handle();
    function Reloader() {
      const viewer = useRef<ModelViewerHandle | null>(h);
      const layer = useFindingsLayer({ projectId: PROJECT_ID, model: MODEL_REVIEWED, viewer });
      return <button onClick={layer.reload}>reload</button>;
    }
    renderWithProviders(<Reloader />, { api, route: `/p/${PROJECT_ID}/models/m1` });
    await waitFor(() => expect(h.setPlacements).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "reload" }));
    await waitFor(() => expect(h.setPlacements).toHaveBeenCalledTimes(2));
    expect(h.setPlacements.mock.calls[1]?.[0][0].center).toEqual([11, 12.4, -3]);
  });
});
