import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { View } from "@/clouds/viewer/camera";
import { NoWebGlError } from "@/clouds/viewer/engine";
import { tokenColor, tokenRgb } from "@/clouds/viewer/overlay";
import { startTween, tweenAt, type Tween } from "@/clouds/viewer/tween";
import { isTypingTarget } from "@/ui/keymap";
import { isReducedMotion } from "@/ui/motion";
import { addSiteLights } from "../layers/sun";
import type { PickHit, Pickable, SiteLayer } from "../layers/types";
import { FLY_KEYS, ISO_DIR, flyDelta, flySpeed, planDir, viewBox, type CamView } from "./camera";
import { pickFirst } from "./pick";
import type { SiteFrameT } from "./siteTransform";
import { TileCache, fetchSiteTile } from "./tiles";

export type NavMode = "orbit" | "pan" | "fly";
export type SelectListener = (hit: PickHit | null) => void;

const CLICK_SLOP_PX = 4;
const FLY_ENTER_AHEAD_M = 10;
const IDLE_MS = 1000;

/** Layer failures name the layer and the error's class only: no message payload reaches the log. */
function logLayerError(what: string, id: string, err: unknown): void {
  console.error(`Site 3D layer ${what} failed`, id, err instanceof Error ? err.name : typeof err);
}

function safeDetach(l: SiteLayer): void {
  try {
    l.detach();
  } catch (err) {
    logLayerError("detach", l.id, err);
  }
}

const vec = (v: THREE.Vector3) => ({ x: v.x, y: v.y, z: v.z });

/**
 * The Site 3D engine (spec 2026-10-03 §11). One WebGLRenderer with a logarithmic depth buffer (the
 * scene spans kilometres and centimetres), a Y-up scene whose origin is the plant origin at the datum
 * (index frame rule), orbit/pan/fly, presets, picking, layers and the shared tile cache. It renders on
 * demand: while a tween, fly movement or tile load runs, and for 1 s after input; then it idles.
 */
export class SiteEngine {
  readonly frame: SiteFrameT | null;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100_000);
  readonly renderer: THREE.WebGLRenderer;
  readonly tiles: TileCache;
  /** S2/S3 read it; do not replace it. */
  readonly canvas: HTMLCanvasElement;
  private readonly host: HTMLElement;
  private readonly controls: OrbitControls;
  private readonly ro: ResizeObserver;
  private readonly layers = new Map<string, SiteLayer>();
  private readonly pickables = new Map<string, Pickable>();
  private readonly content = new Map<string, THREE.Box3>();
  private readonly presetBoxes = new Map<string, { owner: string; box: THREE.Box3 }>();
  private readonly listeners = new Set<SelectListener>();
  private readonly held = new Set<string>();
  private readonly unlisten: Array<() => void> = [];
  private readonly raycaster = new THREE.Raycaster();
  private nav: NavMode = "orbit";
  private shift = false;
  private tween: Tween | null = null;
  private raf = 0;
  private idleUntil = 0;
  private lastTick: number | null = null;
  private downAt: [number, number] | null = null;
  private framed = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, frame: SiteFrameT | null) {
    this.canvas = canvas;
    this.host = canvas.parentElement ?? canvas;
    this.frame = frame;
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        logarithmicDepthBuffer: true,
        powerPreference: "high-performance",
      });
    } catch (err) {
      throw new NoWebGlError(err instanceof Error ? err.message : String(err));
    }
    try {
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.localClippingEnabled = true;
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      this.renderer.setClearColor(tokenColor(tokenRgb("bg")));
      this.camera.up.set(0, 1, 0);
      this.camera.position.set(-400, 360, -400);
      addSiteLights(this.scene);
      this.tiles = new TileCache(fetchSiteTile, () => this.requestRender());
      this.controls = new OrbitControls(this.camera, canvas);
      this.controls.enableDamping = !isReducedMotion();
      this.controls.zoomToCursor = true;
      this.controls.screenSpacePanning = false; // pan along the ground
      this.controls.addEventListener("change", this.requestRender);
      this.ro = new ResizeObserver(this.resize);
      this.ro.observe(this.host);
      this.resize();
      this.listen(canvas, "pointerdown", (e) => {
        const p = e as PointerEvent;
        if (p.button === 0) this.downAt = [p.clientX, p.clientY];
      });
      this.listen(canvas, "pointerup", (e) => {
        const p = e as PointerEvent;
        const d = this.downAt;
        this.downAt = null;
        if (!d || Math.hypot(p.clientX - d[0], p.clientY - d[1]) > CLICK_SLOP_PX) return;
        this.select(this.pick(p.clientX, p.clientY));
      });
      this.listen(window, "keydown", (e) => this.onKey(e as KeyboardEvent, true));
      this.listen(window, "keyup", (e) => this.onKey(e as KeyboardEvent, false));
      this.listen(window, "blur", () => this.held.clear());
    } catch (err) {
      // a half-built engine must not hold the GL context, an observer or a listener
      this.disposed = true;
      this.unlisten.forEach((u) => u());
      const built = this as unknown as Partial<{
        ro: ResizeObserver;
        controls: OrbitControls;
        tiles: TileCache;
      }>;
      built.ro?.disconnect();
      built.controls?.dispose();
      built.tiles?.dispose();
      this.renderer.dispose();
      throw err;
    }
    this.requestRender();
  }

  readonly requestRender = (): void => {
    if (this.disposed) return;
    this.idleUntil = performance.now() + IDLE_MS;
    if (!this.raf) this.raf = requestAnimationFrame(this.loop);
  };

  get navMode(): NavMode {
    return this.nav;
  }

  viewportHeight(): number {
    return this.canvas.clientHeight || 1;
  }

  /** Visible tile drapes (ortho, drawings) sharing the tile budget; at least 1. */
  drapeCount(): number {
    let n = 0;
    for (const l of this.layers.values()) {
      const d = l as Partial<{ isTileDrape: boolean; shown: boolean }>;
      if (d.isTileDrape && d.shown) n += 1;
    }
    return Math.max(1, n);
  }

  addLayer(l: SiteLayer): void {
    if (this.disposed) return;
    if (this.layers.has(l.id)) this.removeLayer(l.id);
    this.layers.set(l.id, l);
    try {
      const pending = l.attach(this);
      if (pending) void pending.catch((err: unknown) => logLayerError("attach", l.id, err));
    } catch (err) {
      logLayerError("attach", l.id, err);
    }
    this.requestRender();
  }

  removeLayer(id: string): void {
    if (this.disposed) return;
    const l = this.layers.get(id);
    if (!l) return;
    this.layers.delete(id);
    safeDetach(l);
    this.pickables.delete(id);
    this.content.delete(id);
    this.clearPresets(id);
    this.requestRender();
  }

  layer(id: string): SiteLayer | undefined {
    return this.layers.get(id);
  }

  addPickable(p: Pickable): void {
    this.pickables.set(p.layerId, p);
  }

  removePickable(layerId: string): void {
    this.pickables.delete(layerId);
  }

  /** A layer's extent; the first one frames the view (fit, no tween). */
  setContentBox(owner: string, box: THREE.Box3 | null): void {
    if (box && !box.isEmpty()) this.content.set(owner, box.clone());
    else this.content.delete(owner);
    if (!this.framed && this.content.size > 0) {
      this.framed = true;
      this.setPreset("fit", { instant: true });
    }
    this.requestRender();
  }

  contentBox(): THREE.Box3 | null {
    if (this.content.size === 0) return null;
    const all = new THREE.Box3();
    for (const b of this.content.values()) all.union(b);
    return all;
  }

  setPresetBox(owner: string, id: string, box: THREE.Box3 | null): void {
    if (box && !box.isEmpty()) this.presetBoxes.set(id, { owner, box: box.clone() });
    else this.presetBoxes.delete(id);
  }

  clearPresets(owner: string): void {
    for (const [id, p] of [...this.presetBoxes]) if (p.owner === owner) this.presetBoxes.delete(id);
  }

  presets(): string[] {
    return ["fit", "plan", ...[...this.presetBoxes.keys()].sort()];
  }

  setPreset(id: string, opts: { instant?: boolean } = {}): void {
    const all = this.contentBox();
    if (id === "fit") {
      if (all) this.goTo(viewBox(all, ISO_DIR, this.camera.fov, this.camera.aspect), opts.instant);
    } else if (id === "plan") {
      if (all) this.goTo(viewBox(all, planDir(), this.camera.fov, this.camera.aspect), opts.instant);
    } else {
      const p = this.presetBoxes.get(id);
      if (p) this.goTo(viewBox(p.box, ISO_DIR, this.camera.fov, this.camera.aspect), opts.instant);
    }
  }

  flyTo(box: THREE.Box3): void {
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-9) dir.copy(ISO_DIR);
    this.goTo(viewBox(box, dir.normalize(), this.camera.fov, this.camera.aspect));
  }

  setNav(mode: NavMode): void {
    this.nav = mode;
    this.held.clear();
    this.controls.mouseButtons.LEFT = mode === "pan" ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    if (mode === "fly") {
      const f = this.controls.target.clone().sub(this.camera.position);
      if (f.lengthSq() > 1e-9)
        this.controls.target.copy(this.camera.position).addScaledVector(f.normalize(), FLY_ENTER_AHEAD_M);
    }
    this.requestRender();
  }

  pick(x: number, y: number): PickHit | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const ndc = new THREE.Vector2(
      ((x - rect.left) / rect.width) * 2 - 1,
      -((y - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    return pickFirst(this.raycaster, [...this.pickables.values()]);
  }

  onSelect(cb: SelectListener): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  /** Tells every listener (the model layer's outline, the screen's panel); null clears. */
  select(hit: PickHit | null): void {
    for (const cb of [...this.listeners]) cb(hit);
    this.requestRender();
  }

  dispose(): void {
    if (this.disposed) return;
    for (const l of [...this.layers.values()]) safeDetach(l);
    this.layers.clear();
    this.pickables.clear();
    this.content.clear();
    this.presetBoxes.clear();
    this.listeners.clear();
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ro.disconnect();
    this.unlisten.forEach((u) => u());
    this.unlisten.length = 0;
    this.controls.removeEventListener("change", this.requestRender);
    this.controls.dispose();
    this.tiles.dispose();
    this.renderer.dispose();
  }

  // `raf` stays set while a frame runs, so a requestRender from inside it (controls "change", a
  // layer update, a tile load) only extends the idle tail; the frame re-arms itself once, at the end.
  private readonly loop = (now: number): void => {
    if (this.disposed) {
      this.raf = 0;
      return;
    }
    let again = false;
    try {
      const dt = this.lastTick === null ? 0 : Math.min((now - this.lastTick) / 1000, 0.1);
      this.lastTick = now;
      let busy = false;
      if (this.tween) {
        const { view, done } = tweenAt(this.tween, now);
        this.applyView(view);
        if (done) this.tween = null;
        else busy = true;
      }
      if (this.nav === "fly" && this.held.size > 0) {
        busy = true;
        if (dt > 0) {
          const forward = this.controls.target.clone().sub(this.camera.position);
          const diag = this.contentBox()?.getSize(new THREE.Vector3()).length() ?? 1000;
          // scene y is the height above the datum (index frame rule)
          const speed = flySpeed(this.camera.position.y, diag, this.shift);
          const step = flyDelta(this.held, forward, speed, dt);
          this.camera.position.add(step);
          this.controls.target.add(step);
        }
      }
      this.controls.update();
      this.tiles.beginFrame();
      for (const l of this.layers.values()) l.update?.(dt, this.camera);
      this.tiles.endFrame();
      this.renderer.render(this.scene, this.camera);
      again = busy || now < this.idleUntil;
      if (!again) this.lastTick = null;
    } finally {
      this.raf = again && !this.disposed ? requestAnimationFrame(this.loop) : 0;
    }
  };

  private readonly resize = (): void => {
    if (this.disposed) return;
    const w = this.host.clientWidth || 1;
    const h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  };

  private goTo(to: CamView, instant = false): void {
    const dist = to.position.distanceTo(to.target);
    this.camera.far = Math.max(100_000, dist * 20);
    this.camera.updateProjectionMatrix();
    const target: View = { position: vec(to.position), target: vec(to.target) };
    if (instant || isReducedMotion()) {
      this.tween = null;
      this.applyView(target);
    } else {
      const from: View = { position: vec(this.camera.position), target: vec(this.controls.target) };
      this.tween = startTween(from, target, performance.now(), false);
    }
    this.requestRender();
  }

  private applyView(v: View): void {
    this.camera.position.set(v.position.x, v.position.y, v.position.z);
    this.controls.target.set(v.target.x, v.target.y, v.target.z);
    this.camera.lookAt(this.controls.target);
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    this.shift = e.shiftKey;
    if (!FLY_KEYS.has(e.code)) return;
    if (down && (e.ctrlKey || e.metaKey || e.altKey)) return; // a chord is a shortcut, not flight
    if (!down) {
      this.held.delete(e.code);
      return;
    }
    if (this.nav !== "fly" || isTypingTarget(e.target)) return;
    e.preventDefault();
    this.held.add(e.code);
    this.requestRender();
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn);
    this.unlisten.push(() => target.removeEventListener(type, fn));
  }
}
