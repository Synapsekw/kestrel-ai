import { act, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { makeStores, renderInWorkspace } from "../test/harness";
import { layer } from "../test/fixtures";
import { useWorkspaceLayers } from "./useWorkspaceLayers";

function Names() {
  const { layers, loading } = useWorkspaceLayers();
  return <p>{loading ? "loading" : layers.map((l) => l.id).join(",")}</p>;
}

describe("useWorkspaceLayers (shared by the layer plugins)", () => {
  it("reads the list the workspace loaded, and its loading flag", () => {
    const stores = makeStores();
    renderInWorkspace(<Names />, { stores });
    expect(screen.getByText("loading")).toBeInTheDocument();
    act(() => stores.workspace.getState().setLayers([layer("map", "m1"), layer("surface", "s1")], false));
    expect(screen.getByText("m1,s1")).toBeInTheDocument();
  });
});
