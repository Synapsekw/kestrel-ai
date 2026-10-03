/* eslint-disable react-refresh/only-export-components --
   The vertex helpers are pure functions exported next to the component so its test can pin them; not a
   fast-refresh boundary. */
import { memo, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Circle, Layer, Line, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { Box } from "@contract/client";
import { scaleFromCamera } from "@/images/tools/measure";
import { getTool } from "@/images/tools/registry";
import { isAccepted, singleSelected, useImagesWorkspace } from "@/store/imagesWorkspace";
import { toast } from "@/ui/toastStore";
import { cmdUpdateShape, type CommandContext } from "./commands";
import { tokenColour, typeColour } from "./colours";
import { LAYER_NAMES } from "./constants";
import {
  clampPoint,
  cornersOf,
  flatten,
  MIN_BOX_SIDE,
  nearestEdge,
  orientedRectOf,
  toPoints,
  type Point,
} from "./geometry";
import { bucketOf, lodPoints } from "./lod";

/** Every 15°; Konva may pass 180 mid-drag, so the list runs to 345 (BoxLayer's reasoning). */
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

export function insertVertex(points: readonly Point[], edgeIndex: number, at: Point): Point[] {
  const out = [...points];
  out.splice(edgeIndex + 1, 0, at);
  return out;
}

/** null when the polygon would drop below 3 vertices (spec §9.2: minimum 3). */
export function removeVertex(points: readonly Point[], index: number): Point[] | null {
  if (points.length <= 3) return null;
  return points.filter((_, i) => i !== index);
}

export function moveVertex(points: readonly Point[], index: number, at: Point): Point[] {
  return points.map((p, i) => (i === index ? at : p));
}

const reducedEffects = () => document.documentElement.dataset.effects === "reduced";

function SelectionGlow({
  box,
  colour,
  bucket,
  scale,
}: {
  box: Box;
  colour: string;
  bucket: number;
  scale: number;
}) {
  const blur = reducedEffects() ? 0 : 10;
  const glow = {
    name: "selection-glow",
    stroke: colour,
    strokeWidth: 3,
    strokeScaleEnabled: false,
    shadowColor: colour,
    shadowBlur: blur,
    shadowOpacity: 0.9,
    listening: false,
    perfectDrawEnabled: false,
  };
  if (box.shape === "point") return <Circle {...glow} x={box.x} y={box.y} radius={9 / scale} />;
  const points =
    box.shape === "polygon" ? lodPoints(box.points ?? [], bucket) : flatten(cornersOf(orientedRectOf(box)));
  return <Line {...glow} points={points} closed />;
}

function VertexHandles({ ctx, box, scale }: { ctx: CommandContext; box: Box; scale: number }) {
  const points = useMemo(() => toPoints(box.points ?? []), [box.points]);
  // Insert and remove use indices of the points as drawn, so their patch is computed now. A vertex
  // move sets one absolute position, so it applies to the points as they stand when it runs and a
  // second drag made while the first is saving does not undo it.
  const save = (next: Point[]) => void cmdUpdateShape(ctx, box.id, { kind: "points", points: next });
  const saveMove = (i: number, at: Point) =>
    void cmdUpdateShape(ctx, box.id, (current) => ({
      kind: "points",
      points: moveVertex(toPoints(current.points ?? []), i, at),
    }));
  // Only Alt+click uses the edges; otherwise a press must reach the polygon below (select, drag)
  // instead of bubbling to the stage, where the select tool would clear the selection.
  const altHeld = useImagesWorkspace((s) => s.altHeld);
  return (
    <>
      <Line
        name="polygon-edges"
        listening={altHeld}
        points={flatten(points)}
        closed
        stroke={tokenColour("accent", 0)}
        strokeWidth={1}
        strokeScaleEnabled={false}
        hitStrokeWidth={10}
        perfectDrawEnabled={false}
        onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
          if (!e.evt.altKey || e.evt.button !== 0) return;
          e.cancelBubble = true;
          const at = e.target.getStage()?.getRelativePointerPosition();
          const hit = at ? nearestEdge(points, at) : null;
          if (hit) save(insertVertex(points, hit.index, hit.at));
        }}
      />
      {points.map((p, i) => (
        <Circle
          key={i}
          name="vertex"
          x={p.x}
          y={p.y}
          radius={5 / scale}
          fill={tokenColour("ink")}
          stroke={tokenColour("accent")}
          strokeWidth={1.5}
          strokeScaleEnabled={false}
          draggable
          perfectDrawEnabled={false}
          onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
            e.cancelBubble = true;
            if (!e.evt.altKey) return;
            const next = removeVertex(points, i);
            if (next) save(next);
            else toast("info", "A polygon needs at least 3 points.");
          }}
          onDragEnd={(e: KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            const image = ctx.store.getState().image;
            const at = image ? clampPoint({ x: e.target.x(), y: e.target.y() }, image) : null;
            if (at) saveMove(i, at);
          }}
        />
      ))}
    </>
  );
}

/**
 * Layer 4: glow, Transformer, vertex handles, the active tool's draft, and the overlay slot.
 * Memoised (m2): ImageCanvas re-renders on every pan frame, this layer only on its own state.
 */
export const InteractionLayer = memo(function InteractionLayer({
  ctx,
  overlay,
}: {
  ctx: CommandContext;
  overlay?: ReactNode;
}) {
  const selected = useImagesWorkspace(singleSelected);
  const selectedIds = useImagesWorkspace((s) => s.selectedIds);
  const boxes = useImagesWorkspace((s) => s.boxes);
  const scale = useImagesWorkspace((s) => s.view.scale);
  const tool = useImagesWorkspace((s) => s.tool);
  const draft = useImagesWorkspace((s) => s.draft);
  const types = useImagesWorkspace((s) => s.types);
  const activeTypeId = useImagesWorkspace((s) => s.activeTypeId);
  const image = useImagesWorkspace((s) => s.image);
  const interacting = useImagesWorkspace((s) => s.interacting);
  const spaceHeld = useImagesWorkspace((s) => s.spaceHeld);
  const shiftHeld = useImagesWorkspace((s) => s.shiftHeld);
  const showAnnotations = useImagesWorkspace((s) => s.showAnnotations);
  const bucket = bucketOf(scale);
  const trRef = useRef<Konva.Transformer>(null);

  const transformable =
    !!selected &&
    tool === "select" &&
    (selected.shape === "box" || selected.shape === "rbox") &&
    isAccepted(selected);
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = transformable && selected ? tr.getStage()?.findOne(`#shape-${selected.id}`) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [transformable, selected]);

  const camera = useMemo(() => scaleFromCamera(image?.camera), [image?.camera]);
  const def = getTool(tool);
  const draftColour = activeTypeId ? typeColour(types, activeTypeId) : tokenColour("accent");
  const glowing = selectedIds.map((id) => boxes[id]).filter((b): b is Box => !!b);

  return (
    <Layer name={LAYER_NAMES.interaction} visible={showAnnotations} listening={!interacting && !spaceHeld}>
      {glowing.map((b) => (
        <SelectionGlow
          key={`glow-${b.id}`}
          box={b}
          colour={typeColour(types, b.class_id)}
          bucket={bucket}
          scale={scale}
        />
      ))}
      {transformable && (
        <Transformer
          ref={trRef}
          rotateEnabled
          rotationSnaps={shiftHeld ? ROTATION_SNAPS : []}
          rotationSnapTolerance={7}
          keepRatio={false}
          ignoreStroke
          anchorSize={8}
          borderEnabled={false}
          // A press on a handle would bubble to the stage, where the select tool clears the
          // selection and unmounts this Transformer mid-gesture (the lab showed dead handles).
          onMouseDown={(e: KonvaEventObject<MouseEvent>) => {
            e.cancelBubble = true;
          }}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < MIN_BOX_SIDE * scale || newBox.height < MIN_BOX_SIDE * scale ? oldBox : newBox
          }
        />
      )}
      {selected?.shape === "polygon" && tool === "select" && (
        <VertexHandles ctx={ctx} box={selected} scale={scale} />
      )}
      {draft && image && def?.renderDraft?.(draft, { scale, colour: draftColour, camera, image })}
      {overlay}
    </Layer>
  );
});
