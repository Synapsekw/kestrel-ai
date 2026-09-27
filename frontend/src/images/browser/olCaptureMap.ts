import OlMap from "ol/Map";
import View from "ol/View";
import Feature from "ol/Feature";
import type { FeatureLike } from "ol/Feature";
import LineString from "ol/geom/LineString";
import Point from "ol/geom/Point";
import Polygon from "ol/geom/Polygon";
import ScaleLine from "ol/control/ScaleLine";
import { shiftKeyOnly } from "ol/events/condition";
import { boundingExtent } from "ol/extent";
import DragBox from "ol/interaction/DragBox";
import { defaults as defaultInteractions } from "ol/interaction/defaults";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import WebGLVectorLayer from "ol/layer/WebGLVector";
import Projection from "ol/proj/Projection";
import TileImage from "ol/source/TileImage";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style } from "ol/style";
import type { FlatStyle } from "ol/style/flat";
import { makeTileGrid } from "@/maps/MapView";
import { olExtent, resolutions } from "@/maps/grid";
import { tokenColour } from "@/maps/styles";
import { HOVER_THROTTLE_MS, throttle, type FootprintShape, type ViewProjection } from "./captureModel";

/** Screen pixels from a point footprint to the end of its heading tick (Ruling 12). */
const TICK_PX = 14;

export interface CaptureMapOptions {
  target: HTMLElement;
  projection: ViewProjection;
  /** `mapTileUrl(...)` of the ortho background, or null for the neutral ground. */
  tileUrl: string | null;
  /** The mini-map: no pan, zoom or lasso; clicks still open. */
  interactive: boolean;
  pointStyle: FlatStyle;
  onHover: (ordinal: number | null, pixel: number[] | null) => void;
  onClick: (ordinal: number) => void;
  onLasso?: (extent: number[]) => void;
}

export interface CaptureMapHandle {
  setPoints(
    ordinals: readonly number[],
    coords: readonly number[][],
    sev: readonly number[],
    count: readonly number[],
  ): void;
  setPointStyle(style: FlatStyle): void;
  setCurrent(coord: number[] | null): void;
  setFootprint(shape: FootprintShape): void;
  setFlightPath(line: number[][] | null): void;
  fit(coords: readonly number[][]): void;
  destroy(): void;
}

/** The only file that touches OpenLayers for the capture map; the React side is testable without it. */
export function createCaptureMap(o: CaptureMapOptions): CaptureMapHandle {
  const accent = tokenColour("accent");
  const points = new VectorSource<Feature<Point>>();
  const pointLayer = new WebGLVectorLayer({ source: points, style: o.pointStyle });

  const under = new VectorSource();
  const footprintStyle = new Style({
    stroke: new Stroke({ color: accent, width: 2 }),
    fill: new Fill({ color: tokenColour("accent", 0.12) }),
  });
  const pathStyle = new Style({ stroke: new Stroke({ color: tokenColour("ink", 0.18), width: 1 }) });
  const underLayer = new VectorLayer({
    source: under,
    style: (f: FeatureLike) => (f.get("role") === "footprint" ? footprintStyle : pathStyle),
  });

  const over = new VectorSource();
  const ringStyle = new Style({
    image: new CircleStyle({ radius: 7, stroke: new Stroke({ color: accent, width: 2 }) }),
  });
  const overLayer = new VectorLayer({
    source: over,
    style: (f: FeatureLike, resolution: number) => {
      if (f.get("role") !== "tick") return ringStyle;
      const at = f.get("at") as number[];
      const r = f.get("rotation") as number;
      const len = TICK_PX * resolution;
      return new Style({
        geometry: new LineString([at, [at[0] + Math.sin(r) * len, at[1] + Math.cos(r) * len]]),
        stroke: new Stroke({ color: accent, width: 2 }),
      });
    },
  });

  const layers = [];
  let view: View;
  let homeExtent: number[] | null = null;
  if (o.projection.kind === "ortho") {
    const m = o.projection.map;
    const extent = olExtent(m);
    homeExtent = extent;
    const projection = new Projection({ code: `kestrel-capture-${m.id}`, units: "pixels", extent });
    if (o.tileUrl) {
      const url = o.tileUrl;
      layers.push(
        new TileLayer({
          source: new TileImage({
            projection,
            tileGrid: makeTileGrid(m),
            tileUrlFunction: (c) =>
              c
                ? url.replace("{z}", String(c[0])).replace("{x}", String(c[1])).replace("{y}", String(c[2]))
                : undefined,
            transition: 0,
          }),
        }),
      );
    }
    view = new View({ projection, resolutions: [...resolutions(m.tile_grid.max_zoom), 0.5, 0.25] });
  } else {
    view = new View({ projection: "EPSG:3857", center: [0, 0], zoom: 2, maxZoom: 22 });
  }
  layers.push(underLayer, pointLayer, overLayer);

  const interactions = o.interactive
    ? defaultInteractions({ shiftDragZoom: false })
    : defaultInteractions({
        dragPan: false,
        mouseWheelZoom: false,
        doubleClickZoom: false,
        pinchZoom: false,
        pinchRotate: false,
        keyboard: false,
        shiftDragZoom: false,
        altShiftDragRotate: false,
      });

  const map = new OlMap({
    target: o.target,
    layers,
    view,
    interactions,
    controls:
      o.projection.kind === "mercator"
        ? [new ScaleLine({ className: "capture-scale", units: "metric" })]
        : [],
  });

  const pick = (pixel: number[]): number | null => {
    const hit = map.forEachFeatureAtPixel(pixel, (f) => ({ ordinal: f.get("ordinal") as number }), {
      layerFilter: (l) => l === pointLayer,
      hitTolerance: 4,
    });
    return hit ? hit.ordinal : null;
  };
  const hover = throttle((pixel: number[]) => {
    const ordinal = pick(pixel);
    o.onHover(ordinal, ordinal === null ? null : pixel);
  }, HOVER_THROTTLE_MS);
  map.on("pointermove", (e) => {
    if (!e.dragging) hover(e.pixel);
  });
  // A trailing throttled hover would otherwise land after the leave and bring the tooltip back.
  const leave = () => {
    hover.cancel();
    o.onHover(null, null);
  };
  map.getViewport().addEventListener("mouseleave", leave);
  map.on("singleclick", (e) => {
    const ordinal = pick(e.pixel);
    if (ordinal !== null) o.onClick(ordinal);
  });
  if (o.interactive && o.onLasso) {
    const box = new DragBox({ condition: shiftKeyOnly });
    box.on("boxend", () => o.onLasso?.(box.getGeometry().getExtent()));
    map.addInteraction(box);
  }

  const replace = (source: VectorSource, role: string, feature: Feature | null) => {
    for (const f of source.getFeatures()) if (f.get("role") === role) source.removeFeature(f);
    if (feature) {
      feature.set("role", role);
      source.addFeature(feature);
    }
  };

  return {
    setPoints(ordinals, coords, sev, count) {
      points.clear(true);
      points.addFeatures(
        coords.map(
          (c, i) =>
            new Feature({ geometry: new Point(c), ordinal: ordinals[i], sev: sev[i], count: count[i] }),
        ),
      );
    },
    setPointStyle(style) {
      pointLayer.setStyle(style);
    },
    setCurrent(coord) {
      replace(over, "current", coord ? new Feature({ geometry: new Point(coord) }) : null);
    },
    setFootprint(shape) {
      replace(
        under,
        "footprint",
        shape?.kind === "polygon" ? new Feature({ geometry: new Polygon([shape.ring]) }) : null,
      );
      replace(
        over,
        "tick",
        shape?.kind === "tick"
          ? new Feature({ geometry: new Point(shape.at), at: shape.at, rotation: shape.rotation })
          : null,
      );
    },
    setFlightPath(line) {
      replace(under, "path", line ? new Feature({ geometry: new LineString(line) }) : null);
    },
    fit(coords) {
      const extent = coords.length > 0 ? boundingExtent(coords as number[][]) : homeExtent;
      if (extent)
        view.fit(extent, {
          padding: [16, 16, 16, 16],
          maxZoom: o.projection.kind === "mercator" ? 19 : undefined,
        });
    },
    destroy() {
      hover.cancel();
      map.getViewport().removeEventListener("mouseleave", leave);
      map.setTarget(undefined);
      map.dispose();
      pointLayer.dispose();
    },
  };
}
