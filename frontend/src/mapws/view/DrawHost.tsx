import { useEffect, useMemo } from "react";
import Feature from "ol/Feature";
import LineString from "ol/geom/LineString";
import Polygon from "ol/geom/Polygon";
import DragBox from "ol/interaction/DragBox";
import DragPan from "ol/interaction/DragPan";
import VectorLayer from "ol/layer/Vector";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";
import { tokenColour } from "@/maps/styles";
import { useTools, useWorkspace, useWorkspaceStores } from "../context";
import { toolRegistry } from "../tools/toolStore";
import type { Coord } from "../types";
import type { SiteExtent } from "./siteGrid";
import { pickSelection, sketchCoords } from "./sketch";
import { useMapPane } from "./SiteMap";

/** The sketch sits above every registered layer (placement z stays under 4000). */
const SKETCH_Z = 9000;
/** Screen pixels within which the double-click's second click repeats the last vertex. */
const DBLCLICK_PX = 3;

/**
 * The generic drawing for every tool (point, line, polygon, box): clicks become store vertices, a
 * double-click finishes, the sketch follows the pointer. Select clicks pick a feature (R-W1-12).
 * Drag-pan runs for Select and Pan, and for any tool while Space is held.
 */
export function DrawHost() {
  const { map } = useMapPane();
  const { tools, workspace } = useWorkspaceStores();
  const active = useTools((s) => s.active);
  const draft = useTools((s) => s.draft);
  const panHold = useTools((s) => s.panHold);
  const pointer = useWorkspace((s) => (draft.length ? s.pointer : null));

  const layer = useMemo(
    () =>
      new VectorLayer({
        source: new VectorSource(),
        zIndex: SKETCH_Z,
        style: new Style({
          stroke: new Stroke({
            color: tokenColour("accent"),
            width: 2,
            lineDash: [6, 4],
          }),
          fill: new Fill({ color: tokenColour("accent", 0.12) }),
        }),
      }),
    [],
  );
  const pan = useMemo(() => new DragPan(), []);

  useEffect(() => {
    map.addLayer(layer);
    map.addInteraction(pan);
    return () => {
      map.removeLayer(layer);
      map.removeInteraction(pan);
    };
  }, [map, layer, pan]);

  useEffect(() => {
    pan.setActive(active === "select" || active === "pan" || panHold);
  }, [pan, active, panHold]);

  useEffect(() => {
    const onClick = (e: MapBrowserEvent) => {
      const t = tools.getState();
      if (t.panHold) return;
      const tool = toolRegistry.get(t.active);
      if (!tool) return;
      if (tool.id === "select") {
        workspace.getState().select(pickSelection(map, e.pixel));
        return;
      }
      const shape = tool.draw.shape;
      if (shape === "point" || shape === "line" || shape === "polygon") t.addVertex(e.coordinate as Coord);
    };
    const onDblClick = (e: MapBrowserEvent) => {
      const t = tools.getState();
      const shape = toolRegistry.get(t.active)?.draw.shape;
      if (shape !== "line" && shape !== "polygon") return;
      e.preventDefault();
      t.finish(DBLCLICK_PX * (map.getView().getResolution() ?? 0));
    };
    map.on("click", onClick);
    map.on("dblclick", onDblClick);
    return () => {
      map.un("click", onClick);
      map.un("dblclick", onDblClick);
    };
  }, [map, tools, workspace]);

  useEffect(() => {
    if (toolRegistry.get(active)?.draw.shape !== "box") return;
    const box = new DragBox();
    box.on("boxend", () => tools.getState().completeBox(box.getGeometry().getExtent() as SiteExtent));
    map.addInteraction(box);
    return () => {
      map.removeInteraction(box);
    };
  }, [map, active, tools]);

  useEffect(() => {
    const source = layer.getSource();
    if (!source) return;
    source.clear();
    const sketch = sketchCoords(draft, pointer, toolRegistry.get(active)?.draw);
    if (!sketch) return;
    source.addFeature(
      new Feature(sketch.type === "Polygon" ? new Polygon([sketch.coords]) : new LineString(sketch.coords)),
    );
  }, [layer, draft, pointer, active]);

  return null;
}
