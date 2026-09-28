import { beforeEach, describe, expect, it, vi } from "vitest";
import { PinsLayerController } from "./pinsController";
import { at, frameCamera, O } from "./testCamera";
import type { PinView } from "./types";

const view = (id: string, dx: number, dy: number, dz: number, extra: Partial<PinView> = {}): PinView => ({
  id,
  p: at(dx, dy, dz),
  normal: null,
  u: 0.05,
  colour: "#ff5a4f",
  label: "Critical · Spalling",
  ariaLabel: `F-${id} · Critical · Spalling`,
  draft: false,
  ...extra,
});

const south = frameCamera(at(0, -100, 30));
const east = frameCamera(at(100, 0, 30));
const el = (host: HTMLElement, id: string) => host.querySelector<HTMLElement>(`[data-id="${id}"]`)!;
/** The x, y of a `translate3d(Xpx, Ypx, 0)` transform. */
const xy = (e: HTMLElement): [number, number] => {
  const m = /translate3d\(([-\d.e]+)px, ([-\d.e]+)px/.exec(e.style.transform);
  if (!m) throw new Error(`no translate3d in "${e.style.transform}"`);
  return [Number(m[1]), Number(m[2])];
};

describe("PinsLayerController", () => {
  let host: HTMLDivElement;
  let onSelect: ReturnType<typeof vi.fn>;
  let ctl: PinsLayerController;
  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    onSelect = vi.fn();
    ctl = new PinsLayerController(host, onSelect);
  });

  it("writes translate3d for visible pins and hides pins behind the camera", () => {
    ctl.setPins([view("a", 0, 0, 0), view("behind", 0, -200, 0)]);
    ctl.frame(south);
    expect(el(host, "a").dataset.state).toBe("visible");
    expect(xy(el(host, "a"))[0]).toBeCloseTo(400, 3);
    expect(xy(el(host, "a"))[1]).toBeCloseTo(250, 3);
    expect(el(host, "behind").dataset.state).toBe("hidden");
    expect(el(host, "a").getAttribute("data-testid")).toBe("cloud-pin");
  });

  it("dims a pin whose normal faces away from the camera", () => {
    ctl.setPins([
      view("front", 0, 0, 0, { normal: [0, -1, 0] }),
      view("far", 0, 0, 0, { normal: [0, 1, 0] }),
    ]);
    ctl.frame(south);
    expect(el(host, "front").dataset.state).toBe("visible");
    expect(el(host, "far").dataset.state).toBe("back");
  });

  it("writes nothing on a frame whose camera did not move", () => {
    ctl.setPins([view("a", 0, 0, 0)]);
    expect(ctl.frame(south)).toBe(true);
    el(host, "a").style.transform = "none";
    expect(ctl.frame(frameCamera(at(0, -100, 30)))).toBe(false);
    expect(el(host, "a").style.transform).toBe("none");
  });

  it("treats a canvas rect move as dirty without clearing occlusion, and updates client-px offsets", () => {
    ctl.setPins([view("a", 0, 0, 0)]);
    ctl.frame(south);
    ctl.applyOcclusion(["a"], [true]);
    expect(el(host, "a").dataset.state).toBe("back");
    // Same position/target/aspect (so the same viewProj), only the canvas's client rect moved.
    const relaid = frameCamera(at(0, -100, 30), O, { left: 50, top: 70, width: 800, height: 500 });
    expect(ctl.frame(relaid)).toBe(false);
    expect(el(host, "a").dataset.state).toBe("back"); // occlusion flag survives a rect-only change
    const [row] = ctl.snapshot();
    expect(row.x).toBeCloseTo(450, 0); // 400 canvas + the new rectLeft (50)
    expect(row.y).toBeCloseTo(320, 0); // 250 canvas + the new rectTop (70)
  });

  it("positions pins set while the loop is idle from the last camera", () => {
    ctl.frame(south);
    ctl.setPins([view("late", 0, 0, 0)]);
    expect(el(host, "late").dataset.state).toBe("visible");
    expect(xy(el(host, "late"))[0]).toBeCloseTo(400, 3);
  });

  it("hides a pin outside a show-inside clip box and dims it in highlight mode", () => {
    ctl.setPins([view("in", 0, 0, 0), view("out", 20, 0, 0)]);
    const contains = (p: readonly number[]) => Math.abs(p[0] - O[0]) < 5;
    ctl.setClip({ contains, mode: "show_inside" });
    ctl.frame(south);
    expect(el(host, "in").dataset.state).toBe("visible");
    expect(el(host, "out").dataset.state).toBe("hidden");
    ctl.setClip({ contains, mode: "highlight_inside" });
    expect(el(host, "out").dataset.state).toBe("back");
  });

  it("targets only shown, saved pins for occlusion with max(0.3, 3u)", () => {
    ctl.setPins([
      view("a", 0, 0, 0, { u: 0.05 }),
      view("coarse", 1, 0, 0, { u: 0.4 }),
      view("behind", 0, -200, 0),
      view("draft", 2, 0, 0, { draft: true }),
    ]);
    ctl.frame(south);
    const t = ctl.occlusionTargets();
    expect(t.ids).toEqual(["a", "coarse"]);
    expect(t.tol[0]).toBeCloseTo(0.3);
    expect(t.tol[1]).toBeCloseTo(1.2);
    expect(t.points[0]).toEqual(at(0, 0, 0));
  });

  it("marks occluded pins back until the camera moves", () => {
    ctl.setPins([view("a", 0, 0, 0), view("b", 1, 0, 0)]);
    ctl.frame(south);
    ctl.applyOcclusion(["a", "b"], [true, false]);
    expect(el(host, "a").dataset.state).toBe("back");
    expect(el(host, "b").dataset.state).toBe("visible");
    ctl.frame(east);
    expect(el(host, "a").dataset.state).toBe("visible");
  });

  it("selects on a head click and pulses the selected pin until its ring ends", () => {
    ctl.setPins([view("a", 0, 0, 0)]);
    el(host, "a").querySelector<HTMLButtonElement>(".kp-pin-head")!.click();
    expect(onSelect).toHaveBeenCalledWith("a");
    ctl.setSelected("a");
    expect(el(host, "a").hasAttribute("data-selected")).toBe(true);
    expect(el(host, "a").hasAttribute("data-pulse")).toBe(true);
    const end = new Event("animationend", { bubbles: true }) as Event & { animationName: string };
    Object.defineProperty(end, "animationName", { value: "kp-ring" });
    el(host, "a").dispatchEvent(end);
    expect(el(host, "a").hasAttribute("data-pulse")).toBe(false);
  });

  it("selects a pin created after setSelected named it (the store change arrives before the render)", () => {
    ctl.setSelected("a");
    ctl.setPins([view("a", 0, 0, 0)]);
    expect(el(host, "a").hasAttribute("data-selected")).toBe(true);
    expect(el(host, "a").hasAttribute("data-pulse")).toBe(true);
  });

  it("drops new pins once and removes pins that are gone", () => {
    expect(ctl.setPins([view("a", 0, 0, 0), view("b", 1, 0, 0)])).toEqual(["a", "b"]);
    expect(el(host, "a").hasAttribute("data-enter")).toBe(true);
    expect(ctl.setPins([view("a", 0, 0, 0, { label: "Minor · Spalling" })])).toEqual([]);
    expect(host.querySelectorAll(".kp-pin")).toHaveLength(1);
    expect(el(host, "a").querySelector(".kp-pin-label")!.textContent).toBe("Minor · Spalling");
  });

  it("places the callout beside the selected pin and hides it with the pin", () => {
    const card = document.createElement("div");
    ctl.attachCallout(card);
    ctl.setCalloutHeight(180);
    ctl.setPins([view("a", 0, 0, 0), view("behind", 0, -200, 0)]);
    ctl.setSelected("a");
    ctl.frame(south);
    expect(card.dataset.state).toBe("shown");
    // 800 px canvas: 400 + 30 + 290 passes 800 − 360, so the card goes to the left (X1's rule)
    expect(card.dataset.side).toBe("left");
    expect(xy(card)[0]).toBeCloseTo(80, 3);
    ctl.setSelected("behind");
    expect(card.dataset.state).toBe("hidden");
  });

  it("snapshots pins in client px with their state, and NaN x/y for a hidden pin", () => {
    ctl.setPins([view("a", 0, 0, 0, { normal: [0, -1, 0] }), view("behind", 0, -200, 0)]);
    ctl.frame(south);
    const [visible, hidden] = ctl.snapshot();
    expect(visible).toMatchObject({ id: "a", state: "visible", occluded: false, normal: [0, -1, 0] });
    expect(visible.x).toBeCloseTo(410, 0);
    expect(visible.y).toBeCloseTo(270, 0);
    expect(visible.passMs).toBeGreaterThanOrEqual(0);
    expect(hidden).toMatchObject({ id: "behind", state: "hidden" });
    expect(hidden.x).toBeNaN();
    expect(hidden.y).toBeNaN();
  });
});
