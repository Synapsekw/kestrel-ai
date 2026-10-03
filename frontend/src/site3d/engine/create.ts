import { SiteEngine } from "./SiteEngine";
import type { SiteFrameT } from "./siteTransform";

/** The one place the screen makes an engine, so a test can swap it (vi.mock("@/site3d/engine/create")). */
export function createSiteEngine(canvas: HTMLCanvasElement, frame: SiteFrameT | null): SiteEngine {
  return new SiteEngine(canvas, frame);
}
