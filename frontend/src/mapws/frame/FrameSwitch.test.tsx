import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiClient } from "@contract/client";
import { fakeClient, type FakeRoute } from "@/test/fixtures";
import { useChangesStore } from "@/store/changes";
import { useToastStore } from "@/ui";
import { LOCAL, UTM33 } from "../test/fixtures";
import { makeStores, renderInWorkspace } from "../test/harness";
import type { SiteFrame } from "../types";
import { FrameSwitch } from "./FrameSwitch";

const FRAME_PUT: FakeRoute = { method: "PUT", path: /\/map-workspace\/frame$/, body: {} };

function setup(
  frame: SiteFrame,
  items: { crs: number; local: number } | null,
  routes: FakeRoute[] = [FRAME_PUT],
) {
  const stores = makeStores({ frame });
  if (items) stores.workspace.getState().setFrameItems(items);
  const { api, requests } = fakeClient(routes);
  const view = renderInWorkspace(<FrameSwitch />, { stores, api });
  return { ...view, requests };
}

const rev = () => useChangesStore.getState().mapWorkspaceRevision;

describe("FrameSwitch (spec M §6, M-B1 hand-off 1)", () => {
  beforeEach(() => useToastStore.getState().clear());

  it.each([
    ["no local items", UTM33, { crs: 3, local: 0 }],
    ["no georeferenced items", LOCAL, { crs: 0, local: 2 }],
    ["counts not read yet", UTM33, null],
  ])("renders nothing with %s", (_name, frame, items) => {
    const { container } = setup(frame, items);
    expect(container).toBeEmptyDOMElement();
  });

  it("in a CRS frame offers local metres and PUTs {kind: local}, then re-reads", async () => {
    const { requests } = setup(UTM33, { crs: 4, local: 2 });
    const r0 = rev();
    await userEvent.click(screen.getByRole("button", { name: "Local metres · 2 surfaces" }));
    await waitFor(() => expect(rev()).toBe(r0 + 1));
    const put = requests.find((r) => r.method === "PUT");
    expect(put?.url).toMatch(/\/map-workspace\/frame$/);
    expect(put?.body).toEqual({ kind: "local" });
  });

  it("in the local frame switches back with {kind: crs} and no epsg (the server's rule M3)", async () => {
    const { requests } = setup(LOCAL, { crs: 1, local: 1 });
    const r0 = rev();
    await userEvent.click(screen.getByRole("button", { name: "Site CRS · 1 item" }));
    await waitFor(() => expect(rev()).toBe(r0 + 1));
    expect(requests.map((r) => [r.method, r.body])).toEqual([["PUT", { kind: "crs" }]]);
  });

  it("toasts the server's message and does not re-read when the switch fails", async () => {
    setup(UTM33, { crs: 4, local: 2 }, [
      {
        method: "PUT",
        path: /\/map-workspace\/frame$/,
        status: 422,
        body: {
          error: { code: "invalid_epsg", message: "EPSG:1 is not a known coordinate system", details: {} },
        },
      },
    ]);
    const r0 = rev();
    const button = screen.getByRole("button", { name: "Local metres · 2 surfaces" });
    await userEvent.click(button);
    await waitFor(() =>
      expect(useToastStore.getState().toasts.map((t) => [t.tone, t.text])).toEqual([
        ["danger", "EPSG:1 is not a known coordinate system"],
      ]),
    );
    expect(rev()).toBe(r0);
    expect(button).toBeEnabled();
  });

  it("is a compact, width-capped text control whose full label stays in its name and tooltip", async () => {
    setup(UTM33, { crs: 4, local: 12 });
    const button = screen.getByRole("button", { name: "Local metres · 12 surfaces" });
    // Text height, not a 28 px button: the coordinates row keeps its height.
    expect(button.className).not.toMatch(/\bh-7\b/);
    expect(button.className).toMatch(/\bmax-w-/);
    expect(button.querySelector(".truncate")).toHaveTextContent("Local metres · 12 surfaces");
    await userEvent.hover(button);
    expect(
      await screen.findByText("Local metres · 12 surfaces. Show the surfaces without coordinates"),
    ).toBeInTheDocument();
  });

  it("is disabled while the switch is pending", async () => {
    let answer: (r: Response) => void = () => {};
    let calls = 0;
    const api = createApiClient({
      baseUrl: "http://fake",
      token: "t",
      fetch: () => {
        calls += 1;
        return new Promise<Response>((resolve) => (answer = resolve));
      },
    });
    const stores = makeStores({ frame: UTM33 });
    stores.workspace.getState().setFrameItems({ crs: 4, local: 2 });
    renderInWorkspace(<FrameSwitch />, { stores, api });
    const button = screen.getByRole("button", { name: /Local metres · 2 surfaces/ });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(calls).toBe(1);
    answer(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    await waitFor(() => expect(button).toBeEnabled());
  });
});
