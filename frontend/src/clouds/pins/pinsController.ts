import type { PinDiag } from "@/clouds/viewer/diagnostics";
import type { FrameCamera, Vec3 } from "@/clouds/viewer/types";
import { placeCallout } from "./callout";
import {
  occlusionTolerance,
  projectPin,
  type PinCamera,
  type PinClip,
  type PinScreen,
  type PinState,
} from "./project";
import type { PinView } from "./types";

interface PinEl {
  view: PinView;
  el: HTMLDivElement;
  head: HTMLButtonElement;
  label: HTMLSpanElement;
  /** The last projection (before occlusion); reused every frame, so the pass allocates nothing. */
  screen: PinScreen;
  /** The last `data-state` written. */
  shown: PinState;
  occluded: boolean;
}

/** V1's `viewProj` is absolute (native CRS), so the classifier's origin is zero (plan Interfaces consumed). */
const ORIGIN = [0, 0, 0] as const;

/**
 * The pins layer (spec §9.2, C5): one element per pin, positioned by direct DOM writes from the
 * viewer's frame hook. React never renders per frame; the controller keeps only each element's last
 * written state, the last projection and the last camera matrix.
 *
 * Named `pinsController.ts` (not `pinsLayer.ts`): Windows resolves `./PinsLayer` and `./pinsLayer` to
 * the same file, which would shadow Task 5's `PinsLayer.tsx` (see the case-insensitive shadowing ADR).
 * The class keeps its plan name, `PinsLayerController`.
 *
 * No `setSuspended`/context-loss handling here (ruling T5-2): W1 unmounts this layer (and the
 * callout) whenever the view is not `"running"`, so a "suspended" state is unreachable from the
 * mounted controller.
 */
export class PinsLayerController {
  private readonly pins = new Map<string, PinEl>();
  private selected: string | null = null;
  private clip: PinClip | null = null;
  private cam: PinCamera | null = null;
  private rectLeft = 0;
  private rectTop = 0;
  private lastViewProj: number[] | null = null;
  private dirty = true;
  private callout: HTMLElement | null = null;
  private calloutHeight = 0;
  lastPassMs = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly onSelect: (id: string) => void,
  ) {}

  /** Adds, updates and removes pin elements; returns the ids added (they play the drop once). */
  setPins(views: readonly PinView[]): string[] {
    const seen = new Set<string>();
    const added: string[] = [];
    for (const v of views) {
      seen.add(v.id);
      const cur = this.pins.get(v.id);
      if (cur) this.update(cur, v, false);
      else {
        this.pins.set(v.id, this.create(v));
        added.push(v.id);
      }
    }
    for (const [id, pin] of this.pins) {
      if (seen.has(id)) continue;
      pin.el.remove();
      this.pins.delete(id);
    }
    this.redraw();
    return added;
  }

  /** The selected pin gets the ring and three pulse cycles (§9.2 Motion). */
  setSelected(id: string | null): void {
    if (this.selected && this.selected !== id)
      this.pins.get(this.selected)?.el.removeAttribute("data-selected");
    this.selected = id;
    const pin = id ? this.pins.get(id) : undefined;
    if (pin) {
      pin.el.setAttribute("data-selected", "");
      pin.el.setAttribute("data-pulse", "");
    }
    this.redraw();
  }

  setClip(clip: PinClip | null): void {
    this.clip = clip;
    this.redraw();
  }

  attachCallout(el: HTMLElement | null): void {
    this.callout = el;
    this.redraw();
  }

  setCalloutHeight(h: number): void {
    if (h === this.calloutHeight) return;
    this.calloutHeight = h;
    this.redraw();
  }

  /**
   * The frame hook's pass. Returns true when the camera moved (which clears the occlusion flags).
   * A change of the canvas rect alone (relayout: left/top/width/height, same `viewProj`) also marks
   * the pass dirty and updates the camera's width/height and the client-px offsets used by
   * `snapshot()`, but is not a camera movement: the occlusion flags are left alone (ruling T4-4).
   */
  frame(cam: FrameCamera): boolean {
    const t0 = performance.now();
    const vp = cam.viewProj;
    let viewChanged = this.lastViewProj === null;
    if (!viewChanged) {
      const last = this.lastViewProj!;
      for (let i = 0; i < 16; i++) {
        if (vp[i] !== last[i]) {
          viewChanged = true;
          break;
        }
      }
    }
    const rect = cam.rect;
    const rectChanged =
      this.cam === null ||
      rect.left !== this.rectLeft ||
      rect.top !== this.rectTop ||
      rect.width !== this.cam.width ||
      rect.height !== this.cam.height;
    if (viewChanged) this.lastViewProj = Array.from(vp);
    if (viewChanged || rectChanged) {
      this.cam = {
        viewProj: this.lastViewProj!,
        width: rect.width,
        height: rect.height,
        position: cam.position,
        origin: ORIGIN,
      };
      this.rectLeft = rect.left;
      this.rectTop = rect.top;
      this.dirty = true;
    }
    if (viewChanged) for (const pin of this.pins.values()) pin.occluded = false;
    this.pass();
    this.lastPassMs = performance.now() - t0;
    return viewChanged;
  }

  /** The saved pins drawn now, with their tolerance `max(0.3, 3u)` (§9.2 "On settle"). */
  occlusionTargets(): { ids: string[]; points: Vec3[]; tol: number[] } {
    const ids: string[] = [];
    const points: Vec3[] = [];
    const tol: number[] = [];
    for (const [id, pin] of this.pins) {
      if (pin.view.draft || pin.shown === "hidden") continue;
      ids.push(id);
      points.push(pin.view.p);
      tol.push(occlusionTolerance(pin.view.u ?? 0));
    }
    return { ids, points, tol };
  }

  applyOcclusion(ids: readonly string[], occluded: readonly boolean[]): void {
    ids.forEach((id, i) => {
      const pin = this.pins.get(id);
      const o = occluded[i] === true;
      if (pin && pin.occluded !== o) {
        pin.occluded = o;
        this.dirty = true;
      }
    });
    this.pass();
  }

  /** `x`/`y` are client px; a hidden pin reports `NaN` for both (`projectPin` leaves its last, now
   * stale, screen position untouched — ruling T4-5), so a consumer must filter by `state` anyway. */
  snapshot(): PinDiag[] {
    return [...this.pins.values()].map((pin) => ({
      id: pin.view.id,
      x: pin.shown === "hidden" ? NaN : this.rectLeft + pin.screen.x,
      y: pin.shown === "hidden" ? NaN : this.rectTop + pin.screen.y,
      state: pin.shown,
      occluded: pin.occluded,
      normal: pin.view.normal,
      passMs: this.lastPassMs,
    }));
  }

  dispose(): void {
    for (const pin of this.pins.values()) pin.el.remove();
    this.pins.clear();
    this.callout = null;
  }

  private redraw(): void {
    this.dirty = true;
    this.pass();
  }

  private pass(): void {
    const cam = this.cam;
    if (!this.dirty || !cam) return;
    this.dirty = false;
    for (const pin of this.pins.values()) {
      const s = pin.screen;
      projectPin(pin.view.p, pin.view.normal, cam, this.clip, s);
      const state: PinState = s.state === "visible" && pin.occluded ? "back" : s.state;
      if (state !== "hidden") pin.el.style.transform = `translate3d(${s.x}px, ${s.y}px, 0)`;
      if (state !== pin.shown) {
        pin.el.dataset.state = state;
        pin.shown = state;
      }
    }
    this.placeCallout(cam);
  }

  private placeCallout(cam: PinCamera): void {
    const card = this.callout;
    if (!card) return;
    const pin = this.selected ? this.pins.get(this.selected) : undefined;
    const place =
      pin && pin.shown !== "hidden"
        ? placeCallout(pin.screen, this.calloutHeight, { width: cam.width, height: cam.height })
        : null;
    if (!place) {
      if (card.dataset.state !== "hidden") card.dataset.state = "hidden";
      return;
    }
    card.style.transform = `translate3d(${place.left}px, ${place.top}px, 0)`;
    card.style.setProperty("--arrow-y", `${place.arrowY}px`);
    if (card.dataset.side !== place.side) card.dataset.side = place.side;
    if (card.dataset.state !== "shown") card.dataset.state = "shown";
  }

  private create(v: PinView): PinEl {
    const el = document.createElement("div");
    el.className = "kp-pin";
    el.dataset.testid = "cloud-pin";
    el.dataset.id = v.id;
    el.dataset.state = "hidden";
    el.setAttribute("data-enter", "");
    el.addEventListener("animationend", (e) => {
      if (e.animationName === "kp-drop") el.removeAttribute("data-enter");
      if (e.animationName === "kp-ring") el.removeAttribute("data-pulse");
    });
    const shadow = document.createElement("span");
    shadow.className = "kp-pin-shadow";
    const ring = document.createElement("span");
    ring.className = "kp-pin-ring";
    const head = document.createElement("button");
    head.type = "button";
    head.className = "kp-pin-head";
    head.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onSelect(v.id);
    });
    const drop = document.createElement("span");
    drop.className = "kp-pin-drop";
    head.append(drop);
    const label = document.createElement("span");
    label.className = "kp-pin-label";
    el.append(shadow, ring, head, label);
    this.host.append(el);
    const pin: PinEl = {
      view: v,
      el,
      head,
      label,
      screen: { state: "hidden", x: 0, y: 0 },
      shown: "hidden",
      occluded: false,
    };
    this.update(pin, v, true);
    return pin;
  }

  private update(pin: PinEl, v: PinView, force: boolean): void {
    const prev = pin.view;
    pin.view = v;
    if (force || prev.colour !== v.colour) pin.el.style.setProperty("--c", v.colour);
    if (force || prev.label !== v.label) pin.label.textContent = v.label;
    if (force || prev.ariaLabel !== v.ariaLabel) pin.head.setAttribute("aria-label", v.ariaLabel);
    if (force || prev.draft !== v.draft) pin.el.toggleAttribute("data-draft", v.draft);
    if (prev.p !== v.p || prev.normal !== v.normal) this.dirty = true;
  }
}
