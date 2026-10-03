import { StrictMode, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TestApiProvider } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { fakeSiteEngine } from "@/test/fakeSiteEngine";
import { FRAME, cloudRow, sceneWith } from "@/test/siteSceneFixtures";
import { CANT_PLACE } from "./cloud.layer";
import { useExtraLayerClicks, useSiteExtraLayers } from "./useSiteExtraLayers";

const scene = sceneWith({ clouds: [cloudRow({ same_crs: false })] });
function setup(strict = false) {
  const { api } = fakeClient([]);
  const f = fakeSiteEngine();
  const wrapper = ({ children }: { children: ReactNode }) => {
    const inner = <TestApiProvider api={api}>{children}</TestApiProvider>;
    return strict ? <StrictMode>{inner}</StrictMode> : inner;
  };
  const hook = renderHook(
    () => useSiteExtraLayers({ engine: f.engine, scene, frame: FRAME, projectId: "p", modelRoot: null }),
    { wrapper },
  );
  return { ...f, hook, wrapper };
}

describe("useSiteExtraLayers", () => {
  it("adds the cloud, water, sky, photos and findings layers, photos off by default", () => {
    const { hook, raw } = setup();
    const rows = hook.result.current.rows;
    expect(rows.map((r) => [r.id, r.group, r.visible])).toEqual([
      ["cloud:c1", "Point clouds", true],
      ["water", "Environment", true],
      ["sky", "Environment", true],
      ["photos", "Data", false],
      ["findings", "Data", true],
    ]);
    expect(raw.addLayer).toHaveBeenCalledTimes(5);
    expect(rows[0].layer.status.get()).toEqual({ kind: "unavailable", reason: CANT_PLACE });
  });

  it("toggles a layer's visibility into the scene", () => {
    const { hook, scene: s3 } = setup();
    act(() => hook.result.current.setVisible("sky", false));
    expect(hook.result.current.rows.find((r) => r.id === "sky")!.visible).toBe(false);
    expect(s3.getObjectByName("site-sky")!.visible).toBe(false);
  });

  it("removes every layer when the screen goes", () => {
    const { hook, raw } = setup();
    hook.unmount();
    expect(raw.removeLayer).toHaveBeenCalledTimes(5);
  });

  it("the point budget is remembered and reaches the cloud host", () => {
    const { hook } = setup();
    act(() => hook.result.current.setBudget(5_000_000));
    expect(hook.result.current.budget).toBe(5_000_000);
    expect(localStorage.getItem("kestrel.clouds.pointBudget")).toBe("5000000");
  });

  it("under StrictMode's mount, unmount, mount each layer ends attached exactly once (R-S2-8)", () => {
    const { hook, raw, layers, scene: s3 } = setup(true);
    const rows = hook.result.current.rows;
    expect(raw.removeLayer).toHaveBeenCalledTimes(5); // StrictMode really did detach once
    expect(raw.addLayer.mock.calls.length - raw.removeLayer.mock.calls.length).toBe(5);
    expect([...layers.keys()]).toEqual(rows.map((r) => r.id));
    for (const r of rows) expect(layers.get(r.id)).toBe(r.layer);
    expect(s3.getObjectsByProperty("name", "site-sky")).toHaveLength(1);
    expect(rows[0].layer.status.get()).toEqual({ kind: "unavailable", reason: CANT_PLACE });
  });

  it("a new engine gets its own layer objects, never the old engine's", () => {
    const { api } = fakeClient([]);
    const a = fakeSiteEngine();
    const b = fakeSiteEngine();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const hook = renderHook(
      ({ engine }) => useSiteExtraLayers({ engine, scene, frame: FRAME, projectId: "p", modelRoot: null }),
      { wrapper, initialProps: { engine: a.engine } },
    );
    const first = hook.result.current.rows.map((r) => r.layer);
    hook.rerender({ engine: b.engine });
    const second = hook.result.current.rows.map((r) => r.layer);
    expect(a.layers.size).toBe(0);
    expect(b.layers.size).toBe(5);
    for (const l of second) expect(first).not.toContain(l);
  });
});

describe("useExtraLayerClicks", () => {
  it("a click (not a drag) on a pin opens its finding; a drag does nothing", () => {
    const { hook, engine, canvas, wrapper } = setup();
    const findings = hook.result.current.findings!;
    vi.spyOn(findings, "hit").mockReturnValue({ findingId: "f1" });
    const on = { photo: vi.fn(), finding: vi.fn() };
    renderHook(() => useExtraLayerClicks(engine, hook.result.current, on), { wrapper });
    canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 11, clientY: 10, button: 0 }));
    expect(on.finding).toHaveBeenCalledWith("f1");
    canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, button: 0 }));
    canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 60, clientY: 10, button: 0 }));
    expect(on.finding).toHaveBeenCalledTimes(1);
  });
});
