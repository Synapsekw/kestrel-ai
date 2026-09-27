import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeClient } from "@/test/fixtures";
import { makeStores, renderInWorkspace } from "../test/harness";
import { WS } from "../test/workspaceScreen";
import { PERSIST_DEBOUNCE_MS, usePersist } from "./usePersist";
import { STATE_MAX_BYTES } from "./workspaceStore";

function Probe() {
  usePersist(true);
  return null;
}

function setup() {
  const stores = makeStores();
  const { api, requests } = fakeClient([{ method: "PUT", path: /\/map-workspace$/, body: WS }]);
  renderInWorkspace(<Probe />, { stores, api });
  const puts = () => requests.filter((r) => r.method === "PUT");
  return { workspace: stores.workspace, puts };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("usePersist (spec §5.2)", () => {
  it("PUTs the state 1 s after a change", async () => {
    const { workspace, puts } = setup();
    act(() => workspace.getState().setOrder("drawings", ["a", "b"]));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    });
    expect(puts()).toHaveLength(1);
  });

  it("does not PUT a state whose JSON is over 64 KB", async () => {
    const { workspace, puts } = setup();
    const keys = Array.from(
      { length: Math.ceil(STATE_MAX_BYTES / 30) + 1 },
      (_, i) => `layer-key-${String(i).padStart(24, "0")}`,
    );
    act(() => workspace.getState().setOrder("drawings", keys));
    expect(JSON.stringify(keys).length).toBeGreaterThan(STATE_MAX_BYTES);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    });
    expect(puts()).toHaveLength(0);
  });
});
