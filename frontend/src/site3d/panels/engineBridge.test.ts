import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import type { SiteEngine } from "@/site3d/engine/SiteEngine";
import type { PickHit } from "@/site3d/layers/types";
import { COLOUR_BY, controlsOf, type ModelLayerLike } from "./engineBridge";

const hit = (layerId: string, itemId: string): PickHit => ({ layerId, itemId, point: [0, 0, 0], extras: {} });

function fakes() {
  let selectCb: ((hit: PickHit | null) => void) | null = null;
  const engine = {
    flyTo: vi.fn(),
    onSelect: vi.fn((cb: (hit: PickHit | null) => void) => {
      selectCb = cb;
      return () => {};
    }),
  } as unknown as SiteEngine;
  const box = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
  const model: ModelLayerLike = {
    select: vi.fn(),
    itemBox: vi.fn(() => box),
    setColourBy: vi.fn(),
    setOpacity: vi.fn(),
  };
  return { engine, model, box, emit: (h: PickHit | null) => selectCb?.(h) };
}

describe("controlsOf", () => {
  it("flies with the engine, selects and boxes through the model layer", () => {
    const { engine, model, box } = fakes();
    const c = controlsOf(engine, model);
    c.flyTo(box);
    expect(engine.flyTo).toHaveBeenCalledWith(box);
    c.select("20-T-0001");
    expect(model.select).toHaveBeenCalledWith("20-T-0001");
    expect(c.boxOf("20-T-0001")).toBe(box);
    expect(model.itemBox).toHaveBeenCalledWith("20-T-0001");
  });

  it("reports 3D selection as a node name, or null", () => {
    const { engine, model, emit } = fakes();
    const cb = vi.fn();
    controlsOf(engine, model).onSelect(cb);
    emit(hit("model", "30-P-0001"));
    emit(null);
    expect(cb.mock.calls).toEqual([["30-P-0001"], [null]]);
  });

  it("a pick on another layer is not a model item", () => {
    const { engine, model, emit } = fakes();
    const cb = vi.fn();
    controlsOf(engine, model).onSelect(cb);
    emit(hit("findings", "f-1"));
    expect(cb.mock.calls).toEqual([[null]]);
  });

  it("passes colour-by and opacity to the model layer", () => {
    const { engine, model } = fakes();
    const c = controlsOf(engine, model);
    c.setColourBy("height_source");
    c.setModelOpacity(0.4);
    expect(model.setColourBy).toHaveBeenCalledWith("height_source");
    expect(model.setOpacity).toHaveBeenCalledWith(0.4);
  });

  it("labels every colour-by mode in sentence case", () => {
    expect(COLOUR_BY.map((c) => c.value)).toEqual(["material", "type", "area", "height_source", "flag"]);
    expect(COLOUR_BY.map((c) => c.label)).toEqual(["Material", "Type", "Area", "Height source", "Flags"]);
  });
});
