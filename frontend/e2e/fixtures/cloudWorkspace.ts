import { expect, type Locator, type Page } from "@playwright/test";
import type { PinDiag } from "@/clouds/viewer/diagnostics";

// C-G ruling G3: every workspace selector lives here (and, for the CDP drivers, in
// frontend/scripts/cloud-ui.mjs: keep the two in step by hand). Owners are named per group.
// Every name below was checked against the merged code (Task 1 Step 5); differences from the
// spec's names are listed in docs/evidence/clouds/README.md -> "Deviations".

/** The contract's Project example, which the Prism mock serves for every project id. */
export const P = "7f1c2e3a-1111-4000-8000-000000000001";
export const API = `/api/v1/projects/${P}`;

/** WebGL on SwiftShader, and WebGL only (vault/decisions/2026-09-26-gotcha-swiftshader-compositing.md). */
export const SWIFTSHADER = {
  launchOptions: { args: ["--use-angle=swiftshader-webgl", "--enable-unsafe-swiftshader"] },
};

export type ToolName =
  | "Orbit"
  | "Pan"
  | "Fly"
  | "Point"
  | "Distance"
  | "Height"
  | "Verticality"
  | "Area"
  | "Cross-section"
  | "Clipping box"
  | "Pin a finding" // spec/brief: "Pin finding"; the palette's real label (tools.ts "pin") is "Pin a finding"
  | "Photo link";

/** Spec §6 palette keys (C-X1's `clouds` keymap scope), confirmed against `frontend/src/ui/keymap.ts`. */
export const TOOL_KEYS: Record<ToolName, string> = {
  Orbit: "o",
  Pan: "h",
  Fly: "w",
  Point: "p",
  Distance: "l",
  Height: "z",
  Verticality: "u",
  Area: "q",
  "Cross-section": "e",
  "Clipping box": "c",
  "Pin a finding": "m",
  "Photo link": "i",
};

/** The workspace's controls, each scoped to its container so no name can match twice. */
export function ws(page: Page) {
  // Palette.tsx: <FloatingToolbar label="Point cloud tools" ...> (brief/spec said "Tools").
  const palette = page.getByRole("toolbar", { name: "Point cloud tools" });
  const inspectorTabs = page.getByRole("tablist", { name: "Inspector" }); // C-W1, confirmed (Inspector.tsx)
  const colourBy = page.getByRole("radiogroup", { name: "Colour by" }); // C-W1 + C-V1, confirmed (CloudPanel.tsx)
  return {
    viewport: page.getByTestId("cloud-centre"), // S1 test id kept by C-W1, confirmed
    canvas: page.getByTestId("cloud-canvas"), // confirmed (CloudViewer.tsx)
    // Readout.tsx: data-testid="cloud-readout" (brief/spec said "pick-readout").
    readout: page.getByTestId("cloud-readout"),
    // HintBar.tsx: data-testid="cloud-hintbar" (brief/spec said "cloud-hint-bar").
    hint: page.getByTestId("cloud-hintbar"),
    callout: page.getByTestId("cloud-callout"), // C-P1, confirmed (pins.tsx)
    palette,
    tool: (name: ToolName): Locator => palette.getByRole("button", { name, exact: true }),
    // CloudPanel.tsx's CloudPicker: aria-label="Point cloud: {name} · {date} · {count}. Choose another"
    // (brief/spec expected the button's name to start with the cloud's own name).
    picker: (cloudName = "Fixture cloud"): Locator =>
      page.getByRole("button", { name: new RegExp(`^Point cloud: ${cloudName}`) }),
    colour: (mode: "RGB" | "Elevation" | "Intensity" | "Class"): Locator =>
      colourBy.getByRole("radio", { name: mode, exact: true }),
    budget: page.getByRole("slider", { name: "Point budget" }),
    pointSize: page.getByRole("slider", { name: "Point size" }),
    edl: page.getByRole("switch", { name: "EDL shading" }),
    cameras: page.getByRole("switch", { name: "Show camera positions" }),
    inspectorTabs,
    findingsTab: inspectorTabs.getByRole("tab", { name: /^Findings/ }),
    measurementsTab: inspectorTabs.getByRole("tab", { name: /^Measurements/ }),
    // Inspector.tsx has no `role="tabpanel"` anywhere (Tabs.tsx's tab buttons carry no
    // aria-controls either): the active tab's body is a plain, unlabelled <div> inside the same
    // GlassPanel as the tab bar. `cloud-inspector` (the GlassPanel's own test id) is the closest
    // real, stable container — it includes the tab bar, not just the body, so a caller that needs
    // only the body's content should scope further (e.g. `findingsTab`/`measurementsTab`'s own
    // named regions: `getByRole("list", { name: "Findings on this cloud" })` /
    // `getByRole("list", { name: "Saved measurements" })`, or FindingsTab's own
    // `getByTestId("cloud-findings-tab")`).
    inspectorPanel: page.getByTestId("cloud-inspector"),
    view: (v: "Top" | "Front" | "Side" | "Iso"): Locator =>
      page.getByRole("button", { name: v, exact: true }),
    // SiteMinimap.tsx: the panel has data-testid="cloud-minimap" with no region role; only its inner
    // <svg> carries role="img" aria-label="Site map: ...". The brief/spec expected a "Site map" region.
    minimap: page.getByTestId("cloud-minimap"),
    photoList: page.getByRole("list", { name: "Photos that saw this point" }), // C-L1, confirmed
  };
}

export async function diagnosticsOn(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("kestrel.diagnostics", "1"));
}

export async function viewerStats(page: Page) {
  return page.evaluate(() => window.__kestrelCloudViewer?.stats() ?? null);
}

/**
 * The viewer's code has loaded and drawn the cloud with nothing left loading. Loading the viewer
 * through the dev server took over 5 s on the CI runner, so this allows 20 s (S1's rule).
 */
export async function viewerSettled(page: Page): Promise<void> {
  await expect
    .poll(async () => (await viewerStats(page))?.settledMs ?? null, { timeout: 20_000 })
    .not.toBeNull();
  await expect.poll(async () => (await viewerStats(page))?.nodesLoading ?? 1).toBe(0);
}

/** A click on the canvas, `dx`/`dy` px from its centre. */
export async function clickCanvas(page: Page, dx = 0, dy = 0): Promise<void> {
  const box = (await page.getByTestId("cloud-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
}

/** Counts requestAnimationFrame calls from page load; call before `goto`. Returns the reader. */
export async function countFrames(page: Page): Promise<() => Promise<number>> {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: number };
    const raf = window.requestAnimationFrame.bind(window);
    w.__frames = 0;
    window.requestAnimationFrame = (cb) => {
      w.__frames++;
      return raf(cb);
    };
  });
  return () => page.evaluate(() => (window as unknown as { __frames: number }).__frames);
}

/** CSS/WAAPI animations still running, as "tag.class: name" (none may run 1 s after settle). */
export async function runningAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((a) => a.playState === "running")
      .map((a) => {
        const t = (a.effect as KeyframeEffect | null)?.target as Element | null;
        const name = (a as CSSAnimation).animationName ?? a.id ?? "animation";
        return `${t?.tagName.toLowerCase() ?? "?"}.${t?.className ?? ""}: ${name}`;
      }),
  );
}

/**
 * C-P1's diagnostics: one pin as `window.__kestrelCloudViewer.pins()` reports it (client px). This is
 * exactly `diagnostics.ts`'s `PinDiag` (no local narrowing) — `pins()` is declared there and the type
 * is re-exported here under the fixtures' own name so later tasks don't reach into `src/`.
 */
export type PinState = PinDiag;

/** C-P1's diagnostics: the projected pins (client px) with their state. */
export async function pinStates(page: Page): Promise<PinState[]> {
  return page.evaluate(() => window.__kestrelCloudViewer?.pins() ?? []);
}

/**
 * `pinStates` filtered to what is actually on screen. C-P1 hand-off: a `hidden` pin's `x`/`y` come
 * back `NaN` (its projection is skipped once a pin is behind the camera or off-frustum), so a caller
 * that wants on-screen positions — a click target, a layout check — must drop `hidden` rows and any
 * row whose `x`/`y` did not come back finite.
 */
export async function visiblePins(page: Page): Promise<PinState[]> {
  const states = await pinStates(page);
  return states.filter((p) => p.state !== "hidden" && Number.isFinite(p.x) && Number.isFinite(p.y));
}
