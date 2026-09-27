import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent } from "@testing-library/react";
import type { ApiClient } from "@contract/client";
import { fakeClient, PROJECT_ID, type FakeRoute } from "@/test/fixtures";
import { ensureBuiltInTools } from "@/images/tools"; // I-FC
import { useToastStore } from "@/ui";
import { useAiStore } from "./aiStore";
import { useCanvasKeyHandlers, useCommandContext, useImagesKeymap, wsGet } from "./bridge";
import { ensureAiRegistered } from "./register";
import { accepted, renderAi, resetAll, seedWorkspace, suggestion } from "./testing";
import { useAiWorkspace, type AiWorkspaceOptions } from "./useAiWorkspace";

function Harness(p: Omit<AiWorkspaceOptions, "projectId">) {
  const ctx = useCommandContext(PROJECT_ID);
  const ai = useAiWorkspace({ projectId: PROJECT_ID, ...p });
  useImagesKeymap([ai.keyHandlers, useCanvasKeyHandlers(ctx)]);
  return null;
}
const press = (key: string, o: Partial<KeyboardEventInit> = {}) =>
  act(() => {
    fireEvent.keyDown(window, { key, ...o });
  });
const reviewRoute = (created: string[] = []): FakeRoute => ({
  method: "POST",
  path: /\/boxes\/review$/,
  body: { updated: 1, finding_ids_created: created, finding_ids_deleted: [] },
});
function mount(api: ApiClient, p: Partial<Omit<AiWorkspaceOptions, "projectId">> = {}) {
  const onOpenImage = p.onOpenImage ?? vi.fn();
  renderAi(<Harness index={p.index ?? null} onOpenImage={onOpenImage} />, api);
  return onOpenImage as ReturnType<typeof vi.fn>;
}
const flush = () => act(async () => {});
const reviews = (requests: { url: string; body: unknown }[]) =>
  requests
    .filter((r) => r.url.endsWith("/boxes/review"))
    .map((r) => r.body as { box_ids: string[]; action: string });

beforeEach(() => {
  resetAll();
  ensureBuiltInTools();
  ensureAiRegistered();
});

describe("FA's keys", () => {
  it("A accepts the top suggestion, selects it and opens its finding", async () => {
    seedWorkspace([suggestion("s1", 0.6), suggestion("s2", 0.9)]);
    const { api, requests } = fakeClient([
      reviewRoute(["f1"]),
      { method: "GET", path: /\/findings\/f1$/, body: { id: "f1", number: 1 } },
    ]);
    mount(api);
    press("a");
    await flush();
    expect(reviews(requests)[0]).toEqual({ box_ids: ["s2"], action: "accept" });
    expect(wsGet().boxes.s2.review_state).toBe("accepted");
    expect(wsGet().selectedIds).toEqual(["s2"]);
    expect(wsGet().findingOf.s2).toBe("f1");
  });

  it("A then 3 grades the new finding", async () => {
    seedWorkspace([suggestion("s1", 0.9)]);
    const { api, requests } = fakeClient([
      reviewRoute(["f1"]),
      { method: "GET", path: /\/findings\/f1$/, body: { id: "f1", number: 1 } },
      { method: "PATCH", path: /\/findings\/f1$/, body: { id: "f1", number: 1, severity: 3 } },
    ]);
    mount(api);
    press("a");
    await flush();
    press("3");
    await flush();
    expect(requests.find((r) => r.method === "PATCH")?.body).toEqual({ severity: 3 });
  });

  it("ignores a digit beyond the severity scale and a selection without a finding", async () => {
    seedWorkspace([accepted("p1"), accepted("p2")]);
    const { api, requests } = fakeClient([]);
    mount(api);
    act(() => {
      wsGet().linkFindings({ p1: "f9" });
      wsGet().select(["p1"]);
    });
    press("9"); // the default scale has 4 levels
    act(() => wsGet().select(["p2"]));
    press("2"); // p2 has no finding
    await flush();
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  });

  it("the threshold hides suggestions from A, X and Tab; ] and [ step it and it is kept per project", async () => {
    seedWorkspace([suggestion("low", 0.3), suggestion("high", 0.8)]);
    const { api, requests } = fakeClient([reviewRoute()]);
    const next = "10000000-5555-4000-8000-00000000000f";
    const onOpenImage = mount(api, { index: { ids: [wsGet().imageId!, next], flags: [2, 2] } });
    for (let i = 0; i < 10; i++) press("]");
    expect(wsGet().threshold).toBe(0.5);
    expect(localStorage.getItem(`kestrel.images.threshold.${PROJECT_ID}`)).toBe("0.5");
    press("Tab");
    expect(wsGet().focusedSuggestionId).toBe("high");
    press("Tab"); // "low" is hidden: cross
    expect(onOpenImage).toHaveBeenCalledWith(next);
    press("x");
    await flush();
    expect(reviews(requests)[0]).toEqual({ box_ids: ["high"], action: "reject" });
    press("[");
    expect(wsGet().threshold).toBe(0.45);
  });

  it("restores the project's threshold on mount and keeps it across an image change", () => {
    localStorage.setItem(`kestrel.images.threshold.${PROJECT_ID}`, "0.4");
    seedWorkspace([]);
    const { api } = fakeClient([]);
    mount(api);
    expect(wsGet().threshold).toBe(0.4);
    act(() => wsGet().loadImage({ ...wsGet().image!, id: "other" }, [], []));
    expect(wsGet().threshold).toBe(0.4);
  });

  it("Tab walks suggestions, then findings, then crosses to the next image with suggestions", () => {
    seedWorkspace([suggestion("s1", 0.9), accepted("f-box")]);
    const { api } = fakeClient([]);
    const me = wsGet().imageId!;
    const onOpenImage = mount(api, {
      index: { ids: ["before", me, "plain", "flagged"], flags: [2, 2, 1, 3] },
    });
    act(() => wsGet().linkFindings({ "f-box": "f7" }));
    press("Tab");
    expect(wsGet().focusedSuggestionId).toBe("s1");
    press("Tab");
    expect(wsGet().selectedIds).toEqual(["f-box"]);
    expect(wsGet().focusedSuggestionId).toBeNull();
    press("Tab");
    expect(onOpenImage).toHaveBeenLastCalledWith("flagged");
    press("Tab", { shiftKey: true });
    expect(wsGet().focusedSuggestionId).toBe("s1");
    press("Tab", { shiftKey: true });
    expect(onOpenImage).toHaveBeenLastCalledWith("before");
  });

  it("two fast A presses accept two different suggestions", async () => {
    seedWorkspace([suggestion("s1", 0.9), suggestion("s2", 0.8)]);
    const { api, requests } = fakeClient([reviewRoute()]);
    mount(api);
    press("a");
    press("a");
    await flush();
    expect(reviews(requests).map((b) => b.box_ids[0])).toEqual(["s1", "s2"]);
  });

  it("Shift+A over 20 visible asks first", () => {
    seedWorkspace(Array.from({ length: 21 }, (_, i) => suggestion(`s${i}`, 0.5)));
    const { api, requests } = fakeClient([reviewRoute()]);
    mount(api);
    press("A", { shiftKey: true });
    expect(useAiStore.getState().confirm).toEqual({
      action: "accept",
      ids: expect.arrayContaining(["s0", "s20"]),
    });
    expect(reviews(requests)).toHaveLength(0);
  });

  it("hidden suggestions (FC's G) are not targets; D opens the menu, then asks it to run", () => {
    seedWorkspace([suggestion("s1", 0.9)]);
    const { api, requests } = fakeClient([reviewRoute()]);
    mount(api);
    press("g");
    expect(wsGet().showSuggestions).toBe(false);
    press("a");
    expect(reviews(requests)).toHaveLength(0);
    press("d");
    expect(useAiStore.getState().menuOpen).toBe(true);
    press("d");
    expect(useAiStore.getState().runNonce).toBe(1);
  });

  it("Esc discards a running detection; with none it falls through to FC (deselect)", () => {
    seedWorkspace([accepted("p1")]);
    const { api } = fakeClient([]);
    mount(api);
    act(() => {
      wsGet().select(["p1"]);
      useAiStore.getState().startDetect(wsGet().imageId!, "m");
    });
    press("Escape");
    expect(useAiStore.getState().detect).toBeNull();
    expect(wsGet().selectedIds).toEqual(["p1"]);
    expect(useToastStore.getState().toasts.at(-1)?.text).toBe("Detection result discarded");
    press("Escape");
    expect(wsGet().selectedIds).toEqual([]);
  });

  it("does nothing while typing", () => {
    seedWorkspace([suggestion("s1", 0.9)]);
    const { api, requests } = fakeClient([reviewRoute()]);
    mount(api);
    expect(wsGet().showSuggestions).toBe(true); // G1: not vacuous
    const input = document.createElement("input");
    document.body.appendChild(input);
    act(() => {
      fireEvent.keyDown(input, { key: "a" });
    });
    expect(reviews(requests)).toHaveLength(0);
    input.remove();
  });

  // G5 / controller ruling: FC's `whenMatches` quiets rows only behind FC's own confirm and picker;
  // FA's BulkConfirm and model menu must quiet FA's keys the same way.
  const quietKeys = () => {
    press("a");
    press("x");
    press("A", { shiftKey: true });
    press("X", { shiftKey: true });
    press("Tab");
    press("Tab", { shiftKey: true });
    press("]");
    press("[");
    press("3");
  };
  const expectUntouched = (
    requests: { method: string; url: string; body: unknown }[],
    onOpenImage: ReturnType<typeof vi.fn>,
  ) => {
    expect(reviews(requests)).toHaveLength(0);
    expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    expect(wsGet().threshold).toBe(0);
    expect(wsGet().focusedSuggestionId).toBeNull();
    expect(wsGet().selectedIds).toEqual(["p1"]);
    expect(onOpenImage).not.toHaveBeenCalled();
  };

  it("quiets A, X, Shift+A/X, Tab, [ ], digits and D while FA's bulk confirm is open", async () => {
    seedWorkspace([suggestion("s1", 0.9), accepted("p1")]);
    const { api, requests } = fakeClient([
      reviewRoute(),
      { method: "PATCH", path: /\/findings\/f1$/, body: {} },
    ]);
    const onOpenImage = mount(api, { index: { ids: [wsGet().imageId!, "next"], flags: [2, 2] } });
    const confirm = { action: "accept" as const, ids: ["s1"] };
    act(() => {
      wsGet().linkFindings({ p1: "f1" });
      wsGet().select(["p1"]);
      useAiStore.getState().askConfirm(confirm);
    });
    quietKeys();
    press("d");
    await flush();
    expectUntouched(requests, onOpenImage);
    expect(useAiStore.getState().menuOpen).toBe(false);
    expect(useAiStore.getState().confirm).toBe(confirm);
  });

  it("quiets the same keys while the model menu is open; D there still runs the model", async () => {
    seedWorkspace([suggestion("s1", 0.9), accepted("p1")]);
    const { api, requests } = fakeClient([
      reviewRoute(),
      { method: "PATCH", path: /\/findings\/f1$/, body: {} },
    ]);
    const onOpenImage = mount(api, { index: { ids: [wsGet().imageId!, "next"], flags: [2, 2] } });
    act(() => {
      wsGet().linkFindings({ p1: "f1" });
      wsGet().select(["p1"]);
      useAiStore.getState().openMenu();
    });
    quietKeys();
    await flush();
    expectUntouched(requests, onOpenImage);
    press("d");
    expect(useAiStore.getState().runNonce).toBe(1);
  });
});
