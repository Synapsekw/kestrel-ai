import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_ID, fakeClient } from "@/test/fixtures";
import { LocationProbe } from "@/test/render";
import { useChangesStore } from "@/store/changes";
import { evaluateHref } from "../links";
import { renderInWorkspace } from "../test/harness";
import { UTM33 } from "../test/fixtures";
import { AUG, SEP, mapLayer, surfaceLayer } from "../test/rasterFixtures";
import { useToastStore } from "@/ui";
import { useGoneLayers } from "./goneLayers";
import { RasterDialogs } from "./RasterDialogs";
import { rasterMenu, useRasterActions } from "./rasterMenu";
import { baseMapRows, elevationRows } from "./rasterRows";

vi.mock("@/runs/RunDialog", () => ({
  RunDialog: ({ initialSourceIds }: { initialSourceIds: string[] }) => (
    <div>run dialog for {initialSourceIds.join(",")}</div>
  ),
}));

const [ortho] = baseMapRows({ layers: [mapLayer("sep", SEP)] });
const [dem] = elevationRows({ layers: [surfaceLayer("dem", AUG, "dem")] });
const [dsm] = elevationRows({ layers: [surfaceLayer("dsm", SEP)] });
const choose = (row: typeof ortho, id: string) =>
  act(() =>
    rasterMenu(row)
      .find((i) => i.id === id)!
      .onSelect(),
  );

function setup() {
  const { api, requests } = fakeClient([
    { method: "PATCH", path: /\/maps\/sep$/, body: {} },
    { method: "PATCH", path: /\/surfaces\/dem$/, body: {} },
    { method: "DELETE", path: /\/maps\/sep$/, status: 204 },
    {
      method: "DELETE",
      path: /\/surfaces\/dsm$/,
      status: 409,
      body: {
        error: {
          code: "conflict",
          message: "Stockpile A uses this surface.",
          details: {},
        },
      },
    },
  ]);
  renderInWorkspace(
    <>
      <RasterDialogs projectId={PROJECT_ID} frame={UTM33} />
      <LocationProbe />
    </>,
    { api },
  );
  return requests;
}

describe("row-menu dialogs (M §5.2)", () => {
  beforeEach(() => useRasterActions.getState().clear());

  it("menus: maps get date, evaluate and delete (Run AI is in the AI topic); only dem surfaces get date and role", () => {
    expect(rasterMenu(ortho).map((i) => i.label)).toEqual([
      "Set survey date",
      "Open in evaluation view",
      "Delete map",
    ]);
    expect(rasterMenu(dem).map((i) => i.label)).toEqual(["Set date and role", "Delete surface"]);
    expect(rasterMenu(dsm).map((i) => i.label)).toEqual(["Delete surface"]);
  });

  it("sets a map's survey date and bumps the workspace revision", async () => {
    const requests = setup();
    const rev = useChangesStore.getState().mapWorkspaceRevision;
    choose(ortho, "date");
    const input = screen.getByLabelText("Survey date");
    await userEvent.clear(input);
    await userEvent.type(input, "2026-09-15");
    await userEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(useChangesStore.getState().mapWorkspaceRevision).toBe(rev + 1));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      captured_on: "2026-09-15",
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sets a dem's date and role", async () => {
    const requests = setup();
    choose(dem, "date");
    await userEvent.click(screen.getByRole("radio", { name: "DSM — surface incl. objects" }));
    await userEvent.click(screen.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(requests.some((r) => r.method === "PATCH")).toBe(true));
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({
      captured_on: AUG,
      elevation_role: "dsm",
    });
  });

  it("opens RunDialog for the map (the AI topic asks) and navigates to the evaluation view", async () => {
    setup();
    act(() => useRasterActions.getState().request({ type: "run", row: ortho }));
    expect(screen.getByText("run dialog for sep")).toBeInTheDocument();
    choose(ortho, "evaluate");
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent(evaluateHref(PROJECT_ID, "sep")),
    );
  });

  it("marks an own delete gone silently, so a late tile 404 does not toast (M §14)", async () => {
    useGoneLayers.setState({ gone: new Set() });
    useToastStore.getState().clear();
    setup();
    choose(ortho, "delete");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(useGoneLayers.getState().gone.has(ortho.key)).toBe(true));
    useGoneLayers.getState().markGone(ortho.key, ortho.name); // a tile that 404s after the delete
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("deletes after confirming, and shows the server's 409", async () => {
    const requests = setup();
    choose(ortho, "delete");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(requests.some((r) => r.method === "DELETE")).toBe(true));
    choose(dsm, "delete");
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText(/Stockpile A uses this surface/)).toBeInTheDocument();
  });
});
