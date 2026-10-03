import { vi } from "vitest";
import type { SiteControls } from "@/site3d/panels/engineBridge";

/** SiteControls with spies; `emitSelect` plays a click in the 3D view. */
export function fakeSiteControls(over: Partial<SiteControls> = {}) {
  const listeners = new Set<(node: string | null) => void>();
  const raw = {
    flyTo: vi.fn(),
    select: vi.fn(),
    onSelect: vi.fn((cb: (node: string | null) => void) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    }),
    boxOf: vi.fn(() => null),
    setColourBy: vi.fn(),
    setModelOpacity: vi.fn(),
    ...over,
  };
  return {
    controls: raw as unknown as SiteControls,
    raw,
    emitSelect: (node: string | null) => listeners.forEach((cb) => cb(node)),
  };
}
