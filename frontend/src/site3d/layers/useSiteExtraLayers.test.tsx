import { StrictMode, type ReactNode } from "react";
import type * as THREE from "three";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SEVERITY_SCALE, SeverityScaleContext, type SeverityLevel } from "@/ui";
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

  it("a severity scale change keeps the layer set and recolours the pins in place", async () => {
    const ortho = {
      id: "o1",
      name: "Ortho",
      tile_url_template: "",
      bounds_site: [0, 0, 1, 1],
      min_z: 7,
      max_z: 17,
    };
    const s = sceneWith({ orthos: [ortho], findings: { count: 1, url: "" } });
    const pin = {
      id: "f1",
      number: 1,
      type_id: "t",
      severity: 4,
      status: "open",
      created_by: "human",
      map_id: "o1",
      geometry_site: { type: "Point", coordinates: FRAME.origin_crs },
    };
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/map-workspace\/findings$/, body: { items: [pin], truncated: false } },
    ] as never);
    const f = fakeSiteEngine();
    let scale: readonly SeverityLevel[] = DEFAULT_SEVERITY_SCALE;
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>
        <SeverityScaleContext.Provider value={scale}>{children}</SeverityScaleContext.Provider>
      </TestApiProvider>
    );
    const hook = renderHook(
      () => useSiteExtraLayers({ engine: f.engine, scene: s, frame: FRAME, projectId: "p", modelRoot: null }),
      { wrapper },
    );
    const findings = hook.result.current.findings!;
    await waitFor(() => expect(findings.status.get().kind).toBe("ready"));
    const layers = hook.result.current.rows.map((r) => r.layer);
    const reads = requests.length;
    const adds = f.raw.addLayer.mock.calls.length;

    scale = DEFAULT_SEVERITY_SCALE.map((l) => (l.level === 4 ? { ...l, colour: "#0000ff" } : l));
    hook.rerender();

    hook.result.current.rows.forEach((r, k) => expect(r.layer).toBe(layers[k]));
    expect(f.raw.addLayer.mock.calls.length).toBe(adds);
    expect(requests).toHaveLength(reads);
    const col = (f.scene.getObjectByName("site-findings") as THREE.Points).geometry.getAttribute("color");
    expect([col.getX(0), col.getY(0), col.getZ(0)]).toEqual([0, 0, 1]);
  });

  it("a layer toggle survives a scene reload (a new scene object rebuilds the set)", () => {
    const { api } = fakeClient([]);
    const f = fakeSiteEngine();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestApiProvider api={api}>{children}</TestApiProvider>
    );
    const hook = renderHook(
      ({ s }) =>
        useSiteExtraLayers({ engine: f.engine, scene: s, frame: FRAME, projectId: "p", modelRoot: null }),
      { wrapper, initialProps: { s: scene } },
    );
    act(() => hook.result.current.setVisible("sky", false));
    act(() => hook.result.current.setVisible("photos", true));
    const firstSky = hook.result.current.rows.find((r) => r.id === "sky")!.layer;

    hook.rerender({ s: { ...scene } });

    const rows = hook.result.current.rows;
    expect(rows.find((r) => r.id === "sky")!.layer).not.toBe(firstSky);
    expect(rows.find((r) => r.id === "sky")!.visible).toBe(false);
    expect(rows.find((r) => r.id === "photos")!.visible).toBe(true);
    expect(f.scene.getObjectByName("site-sky")!.visible).toBe(false);
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

  it("a pin or glyph wins the click: the model pick on the same canvas never hears it (S3-9 minor 5)", () => {
    const { hook, engine, canvas, wrapper } = setup();
    // S1's engine picks the model on the canvas's own (bubble) pointerup listener, added first.
    const modelPick = vi.fn();
    canvas.addEventListener("pointerup", modelPick);
    const hit = vi.spyOn(hook.result.current.findings!, "hit").mockReturnValue({ findingId: "f1" });
    const on = { photo: vi.fn(), finding: vi.fn() };
    renderHook(() => useExtraLayerClicks(engine, hook.result.current, on), { wrapper });
    const click = () => {
      canvas.dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 10, button: 0 }));
      canvas.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 10, button: 0 }));
    };
    click();
    expect(on.finding).toHaveBeenCalledWith("f1");
    expect(modelPick).not.toHaveBeenCalled();
    // Nothing of S2's under the pointer: the model pick runs as before.
    hit.mockReturnValue(null);
    click();
    expect(modelPick).toHaveBeenCalledTimes(1);
    canvas.removeEventListener("pointerup", modelPick);
  });
});
