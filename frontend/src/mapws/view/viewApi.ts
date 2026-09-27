import type OlMap from "ol/Map";
import type View from "ol/View";
import { dur, isReducedMotion } from "@/ui";
import type { ViewApi, ViewInfo } from "../state/workspaceStore";
import type { Coord } from "../types";

/** Fit padding (top, right, bottom, left) that keeps the fitted extent clear of the panels. */
export const FIT_PADDING = [96, 350, 150, 380];

const duration = (): number => (isReducedMotion() ? 0 : dur.base);

export function makeViewApi(view: View, mapOf: () => OlMap | null = () => null): ViewApi {
  return {
    pixelOf: (c: Coord) => {
      const px = mapOf()?.getPixelFromCoordinate(c);
      return px ? [px[0], px[1]] : null;
    },
    coordOf: (px: [number, number]) => {
      const c = mapOf()?.getCoordinateFromPixel(px);
      return c ? [c[0], c[1]] : null;
    },
    centreOn: (c: Coord, resolution?: number) => {
      const current = view.getResolution();
      const res =
        resolution !== undefined && (current === undefined || resolution < current) ? resolution : undefined;
      const d = duration();
      if (d === 0) {
        view.setCenter(c);
        if (res !== undefined) view.setResolution(res);
      } else
        view.animate({
          center: c,
          ...(res !== undefined ? { resolution: res } : {}),
          duration: d,
        });
    },
    fit: (extent) =>
      view.fit(extent, {
        padding: FIT_PADDING,
        duration: duration(),
        maxZoom: 19,
      }),
    zoomBy: (delta) => {
      const z = view.getZoom();
      if (z === undefined) return;
      const d = duration();
      if (d === 0) view.setZoom(z + delta);
      else view.animate({ zoom: z + delta, duration: d });
    },
    resetNorth: () => {
      const d = duration();
      if (d === 0) view.setRotation(0);
      else view.animate({ rotation: 0, duration: d });
    },
  };
}

export function readView(view: View): ViewInfo {
  const c = view.getCenter() ?? [0, 0];
  return {
    center: [c[0], c[1]],
    resolution: view.getResolution() ?? 1,
    rotation: view.getRotation(),
  };
}
