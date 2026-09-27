import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { ensureBuiltInTools } from "@/images/tools"; // I-FC
import { useAiStore } from "./aiStore";
import { useCanvasKeyHandlers, useCommandContext, useImagesKeymap, wsGet } from "./bridge";
import { BulkConfirm } from "./BulkConfirm";
import { ensureAiRegistered } from "./register";
import { renderAi, resetAll, seedWorkspace, suggestion } from "./testing";
import { useAiWorkspace } from "./useAiWorkspace";

function Harness() {
  const ctx = useCommandContext(PROJECT_ID);
  const ai = useAiWorkspace({ projectId: PROJECT_ID, index: null, onOpenImage: vi.fn() });
  useImagesKeymap([ai.keyHandlers, useCanvasKeyHandlers(ctx)]);
  return <BulkConfirm projectId={PROJECT_ID} />;
}
const reviewRoute: FakeRoute = {
  method: "POST",
  path: /\/boxes\/review$/,
  body: { updated: 2, finding_ids_created: [], finding_ids_deleted: [] },
};
const reviews = (requests: { url: string; body: unknown }[]) =>
  requests.filter((r) => r.url.endsWith("/boxes/review")).map((r) => r.body);

function open(action: "accept" | "reject", ids = ["s1", "s2"]) {
  seedWorkspace([suggestion("s1", 0.9), suggestion("s2", 0.8)]);
  const { api, requests } = fakeClient([reviewRoute]);
  renderAi(<Harness />, api);
  act(() => useAiStore.getState().askConfirm({ action, ids }));
  return requests;
}

beforeEach(() => {
  resetAll();
  ensureBuiltInTools();
  ensureAiRegistered();
});

describe("BulkConfirm", () => {
  it("confirming sends one review with the captured ids and action, and closes", async () => {
    const requests = open("reject");
    fireEvent.click(screen.getByRole("button", { name: "Reject 2" }));
    await act(async () => {});
    expect(reviews(requests)).toEqual([{ box_ids: ["s1", "s2"], action: "reject" }]);
    expect(useAiStore.getState().confirm).toBeNull();
    expect(screen.queryByTestId("ai-bulk-confirm")).toBeNull();
  });

  it("Cancel sends nothing and closes", async () => {
    const requests = open("accept");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => {});
    expect(reviews(requests)).toHaveLength(0);
    expect(useAiStore.getState().confirm).toBeNull();
    expect(screen.queryByTestId("ai-bulk-confirm")).toBeNull();
  });

  it("Tab moves focus inside it: FA's Tab row never sees the key", () => {
    open("accept");
    const first = screen.getByRole("button", { name: "Close" });
    expect(document.activeElement).toBe(first);
    const last = screen.getByRole("button", { name: "Accept 2" });
    const focus = vi.spyOn(wsGet(), "focusSuggestion");
    // Neither is a wrap edge of the focus trap, so only the window shortcut could prevent them.
    let tabAllowed = false;
    let shiftTabAllowed = false;
    act(() => {
      tabAllowed = fireEvent.keyDown(first, { key: "Tab" });
      last.focus(); // the trap reads document.activeElement
      shiftTabAllowed = fireEvent.keyDown(last, { key: "Tab", shiftKey: true });
    });
    expect(tabAllowed).toBe(true);
    expect(shiftTabAllowed).toBe(true);
    expect(focus).not.toHaveBeenCalled();
  });
});
