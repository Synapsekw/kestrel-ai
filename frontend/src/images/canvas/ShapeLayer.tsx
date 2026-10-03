/* eslint-disable react-refresh/only-export-components --
   dragPatch is a pure helper exported next to the component so its test can pin it; not a
   fast-refresh boundary. */
import { memo, useCallback, useMemo } from "react";
import { Circle, Layer, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Box, ClassDef } from "@contract/client";
import { pushLog } from "@/app/diagnostics";
import { lengthLabel, scaleFromCamera } from "@/images/tools/measure";
import { getTool } from "@/images/tools/registry";
import { acceptedShapes, useImagesWorkspace } from "@/store/imagesWorkspace";
import { cmdUpdateShape, type CommandContext, type ShapePatch } from "./commands";
import { tokenColour, typeColour, withAlpha } from "./colours";
import { LABEL_MIN_PX, LAYER_NAMES } from "./constants";
import {
  clampOriented,
  clampPoint,
  cornersOf,
  distance,
  orientedRectOf,
  toPoints,
  translatePoints,
  type Size,
} from "./geometry";
import { bucketOf, lodPoints } from "./lod";

export interface ShapeNodeProps {
  box: Box;
  colour: string;
  variant: "accepted" | "suggestion";
  selected: boolean;
  hovered: boolean;
  bucket: number;
  scale: number;
  interactive: boolean;
  onPointerDown?: (id: string, e: KonvaEventObject<MouseEvent>) => void;
  onDragEnd?: (id: string, e: KonvaEventObject<Event>) => void;
}

interface NodeLike {
  x(): number;
  y(): number;
  width(): number;
  height(): number;
  scaleX(): number;
  scaleY(): number;
  rotation(): number;
}

/** The geometry a drag or Transformer gesture left on a node (BoxLayer's commit, generalised). */
export function dragPatch(box: Box, node: NodeLike, image: Size): ShapePatch {
  if (box.shape === "polygon") {
    return { kind: "points", points: translatePoints(toPoints(box.points ?? []), node.x(), node.y()) };
  }
  if (box.shape === "point") return { kind: "point", at: clampPoint({ x: node.x(), y: node.y() }, image) };
  const w = node.width() * node.scaleX();
  const h = node.height() * node.scaleY();
  return {
    kind: "rect",
    rect: clampOriented({ x: node.x() - w / 2, y: node.y() - h / 2, w, h, angle: node.rotation() }, image),
  };
}

/** Puts a node back on its stored geometry after a save, or after a failed one. */
function resync(node: Konva.Node, box: Box | undefined): void {
  if (!box) return;
  if (box.shape === "polygon") node.position({ x: 0, y: 0 });
  else if (box.shape === "point") node.position({ x: box.x, y: box.y });
  else {
    node.scale({ x: 1, y: 1 });
    node.setAttrs({
      x: box.x + box.w / 2,
      y: box.y + box.h / 2,
      offsetX: box.w / 2,
      offsetY: box.h / 2,
      width: box.w,
      height: box.h,
      rotation: box.angle,
    });
  }
  node.getLayer()?.batchDraw();
}

function ShapeNodeImpl(p: ShapeNodeProps) {
  const { box, colour, variant, selected, hovered, bucket, scale, interactive } = p;
  const common = {
    id: `shape-${box.id}`,
    name: `shape ${variant}`,
    stroke: variant === "suggestion" ? tokenColour("ok") : colour,
    strokeWidth: selected ? 3 : 2,
    strokeScaleEnabled: false,
    dash: variant === "suggestion" ? [8, 4] : undefined,
    perfectDrawEnabled: false,
    shadowForStrokeEnabled: false,
    // A near-invisible fill makes the inside clickable; the hovered/selected tint uses the type colour.
    fill: selected || hovered ? withAlpha(colour, 0.2) : "rgba(0,0,0,0.01)",
    listening: interactive,
    draggable: interactive && variant === "accepted",
    onMouseDown: (e: KonvaEventObject<MouseEvent>) => p.onPointerDown?.(box.id, e),
    onDragEnd: (e: KonvaEventObject<DragEvent>) => p.onDragEnd?.(box.id, e),
    onTransformEnd: (e: KonvaEventObject<Event>) => p.onDragEnd?.(box.id, e),
    onMouseEnter: () => useImagesWorkspace.getState().hover(box.id),
    onMouseLeave: () => useImagesWorkspace.getState().hover(null),
  };
  if (box.shape === "polygon")
    return <Line {...common} points={lodPoints(box.points ?? [], bucket)} closed />;
  if (box.shape === "point")
    return <Circle {...common} x={box.x} y={box.y} radius={6 / scale} fill={colour} />;
  return (
    <Rect
      {...common}
      x={box.x + box.w / 2}
      y={box.y + box.h / 2}
      offsetX={box.w / 2}
      offsetY={box.h / 2}
      width={box.w}
      height={box.h}
      rotation={box.angle}
    />
  );
}

/** Scale only matters to a point's screen-size radius; everything else redraws by bucket. */
function sameNode(a: ShapeNodeProps, b: ShapeNodeProps): boolean {
  return (
    a.box === b.box &&
    a.colour === b.colour &&
    a.variant === b.variant &&
    a.selected === b.selected &&
    a.hovered === b.hovered &&
    a.bucket === b.bucket &&
    a.interactive === b.interactive &&
    a.onPointerDown === b.onPointerDown &&
    a.onDragEnd === b.onDragEnd &&
    (a.box.shape !== "point" || a.scale === b.scale)
  );
}

/** One shape on the canvas. FA draws suggestions with `variant="suggestion"` (static teal dash). */
export const ShapeNode = memo(ShapeNodeImpl, sameNode);

function labelAnchor(b: Box) {
  if (b.shape === "polygon" || b.shape === "point") return { x: b.x, y: b.y };
  return cornersOf(orientedRectOf(b)).reduce((a, p) => (p.y < a.y ? p : a));
}

function ShapeLabels({ list, types }: { list: Box[]; types: ClassDef[] }) {
  const scale = useImagesWorkspace((s) => s.view.scale);
  const selectedIds = useImagesWorkspace((s) => s.selectedIds);
  const hoveredId = useImagesWorkspace((s) => s.hoveredId);
  const px = 1 / scale;
  return (
    <>
      {list
        .filter(
          (b) =>
            b.id === hoveredId ||
            selectedIds.includes(b.id) ||
            (b.shape !== "point" && b.h * scale >= LABEL_MIN_PX),
        )
        .map((b) => {
          const at = labelAnchor(b);
          return (
            <Text
              key={`label-${b.id}`}
              name={`label ${b.id}`}
              x={at.x}
              y={at.y - 14 * px}
              text={types.find((t) => t.id === b.class_id)?.name ?? "Unknown type"}
              fontSize={12 * px}
              fill={typeColour(types, b.class_id)}
              listening={false}
              perfectDrawEnabled={false}
            />
          );
        })}
    </>
  );
}

/** One handler for every measurement line (m2): the id comes from the node's name. */
function onMeasurementDown(e: KonvaEventObject<MouseEvent>): void {
  if (e.evt.button !== 0) return;
  e.cancelBubble = true;
  const id = e.target.name().split(" ")[1];
  if (id) useImagesWorkspace.getState().selectMeasurement(id);
}

function MeasurementNodes({ interactive }: { interactive: boolean }) {
  const measurements = useImagesWorkspace((s) => s.measurements);
  const selectedId = useImagesWorkspace((s) => s.selectedMeasurementId);
  const scale = useImagesWorkspace((s) => s.view.scale);
  const camera = useImagesWorkspace((s) => s.image?.camera);
  const cam = useMemo(() => scaleFromCamera(camera), [camera]);
  const colour = tokenColour("accent");
  const px = 1 / scale;
  return (
    <>
      {Object.values(measurements).flatMap((m) => {
        const len = distance({ x: m.x1, y: m.y1 }, { x: m.x2, y: m.y2 });
        return [
          <Line
            key={`m-${m.id}`}
            name={`measurement ${m.id}`}
            points={[m.x1, m.y1, m.x2, m.y2]}
            stroke={colour}
            strokeWidth={m.id === selectedId ? 3 : 2}
            strokeScaleEnabled={false}
            hitStrokeWidth={12}
            listening={interactive}
            perfectDrawEnabled={false}
            onMouseDown={onMeasurementDown}
          />,
          <Text
            key={`ml-${m.id}`}
            name={`measurement-label ${m.id}`}
            x={(m.x1 + m.x2) / 2 + 6 * px}
            y={(m.y1 + m.y2) / 2 + 6 * px}
            text={lengthLabel(len, cam)}
            fontSize={12 * px}
            fill={colour}
            listening={false}
            perfectDrawEnabled={false}
          />,
        ];
      })}
    </>
  );
}

/**
 * Layer 2: accepted shapes, their labels, and the image's length measurements (spec §9.1).
 * Memoised (m2): ImageCanvas re-renders on every pan frame, this layer only on its own state.
 */
export const ShapeLayer = memo(function ShapeLayer({ ctx }: { ctx: CommandContext }) {
  const boxes = useImagesWorkspace((s) => s.boxes);
  const order = useImagesWorkspace((s) => s.order);
  const showAnnotations = useImagesWorkspace((s) => s.showAnnotations);
  const types = useImagesWorkspace((s) => s.types);
  const selectedIds = useImagesWorkspace((s) => s.selectedIds);
  const hoveredId = useImagesWorkspace((s) => s.hoveredId);
  const tool = useImagesWorkspace((s) => s.tool);
  const interacting = useImagesWorkspace((s) => s.interacting);
  const spaceHeld = useImagesWorkspace((s) => s.spaceHeld);
  const scale = useImagesWorkspace((s) => s.view.scale);
  const bucket = bucketOf(scale);
  const list = useMemo(() => acceptedShapes({ boxes, order, showAnnotations: true }), [boxes, order]);
  // m1: the nodes do not take `interacting`; the layer's `listening` already covers a gesture, so
  // its start and end do not re-render every node.
  const nodesInteractive = !(getTool(tool)?.drawsShapes ?? false) && !spaceHeld;
  const interactive = nodesInteractive && !interacting;

  const onPointerDown = useCallback((id: string, e: KonvaEventObject<MouseEvent>) => {
    // Left button only: a middle press is the pan gesture and must not select.
    if (e.evt.button !== 0) return;
    e.cancelBubble = true;
    const s = useImagesWorkspace.getState();
    if (e.evt.shiftKey) s.select([id], "toggle");
    else if (!(s.selectedIds.length === 1 && s.selectedIds[0] === id)) s.select([id]);
  }, []);

  const onDragEnd = useCallback(
    (id: string, e: KonvaEventObject<Event>) => {
      e.cancelBubble = true;
      const s = ctx.store.getState();
      const box = s.boxes[id];
      const node = e.target as Konva.Node & NodeLike;
      if (!box || !s.image) return;
      // Computed now, from the box as drawn: the node's offset is relative to that geometry, even
      // while an earlier drag's save is still queued (the node is resynced only after it lands).
      void cmdUpdateShape(ctx, id, dragPatch(box, node, s.image))
        .catch((err: unknown) => pushLog(`commit shape failed: ${String(err)}`))
        .then(() => resync(node, ctx.store.getState().boxes[id]));
    },
    [ctx],
  );

  return (
    <Layer name={LAYER_NAMES.annotations} listening={interactive} visible={showAnnotations}>
      {list.map((b) => (
        <ShapeNode
          key={b.id}
          box={b}
          colour={typeColour(types, b.class_id)}
          variant="accepted"
          selected={selectedIds.includes(b.id)}
          hovered={hoveredId === b.id}
          bucket={bucket}
          scale={scale}
          interactive={nodesInteractive}
          onPointerDown={onPointerDown}
          onDragEnd={onDragEnd}
        />
      ))}
      <ShapeLabels list={list} types={types} />
      <MeasurementNodes interactive={interactive} />
    </Layer>
  );
});
