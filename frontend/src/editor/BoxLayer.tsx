import { useEffect, useMemo, useRef } from "react";
import { Layer, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { ClassDef } from "@contract/client";
import { pushLog } from "@/app/diagnostics";
import { useEditorStore, visibleBoxes } from "@/store/editor";
import {
  clampOriented,
  cornersOf,
  MIN_BOX_SIDE,
  orientedRectOf,
  roundOriented,
  type OrientedRect,
} from "./geometry";
import { colourOf, nameOf } from "./labels";

interface Props {
  classes: ClassDef[];
  /** Resolves when the move/resize has been saved or has failed; the node is re-synced from the store then. */
  onCommitRect: (id: string, before: OrientedRect, after: OrientedRect) => Promise<void>;
}

/**
 * Every 15 degrees. The list runs to 345 even though a stored `angle` is always in [0, 180):
 * Konva's node rotation is free to pass through 180 during a drag, and normalisation happens once
 * on commit. The node and the store are allowed to disagree during a drag and only during a drag.
 */
const ROTATION_SNAPS = Array.from({ length: 24 }, (_, i) => i * 15);

/** Boxes in image pixels; strokes, dashes and labels are kept in screen pixels through `strokeScaleEnabled={false}` and 1/scale. */
export function BoxLayer({ classes, onCommitRect }: Props) {
  const boxes = useEditorStore((s) => s.boxes);
  const order = useEditorStore((s) => s.order);
  const showRejected = useEditorStore((s) => s.showRejected);
  const selectedId = useEditorStore((s) => s.selectedId);
  const hoveredId = useEditorStore((s) => s.hoveredId);
  const draft = useEditorStore((s) => s.draft);
  const scale = useEditorStore((s) => s.view.scale);
  const spaceHeld = useEditorStore((s) => s.spaceHeld);
  const shiftHeld = useEditorStore((s) => s.shiftHeld);
  const image = useEditorStore((s) => s.image);
  const select = useEditorStore((s) => s.select);
  const hover = useEditorStore((s) => s.hover);
  const minConfidence = useEditorStore((s) => s.minConfidence);
  const list = useMemo(
    () => visibleBoxes({ boxes, order, showRejected, minConfidence }),
    [boxes, order, showRejected, minConfidence],
  );

  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef(new Map<string, Konva.Rect>());
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selectedId ? nodeRefs.current.get(selectedId) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selectedId, list]);

  if (!image) return null;
  const px = (n: number) => n / scale;

  /** The Konva node follows the store again: the saved box on success, the old one on failure. */
  const syncNode = (id: string) => {
    const node = nodeRefs.current.get(id);
    const box = useEditorStore.getState().boxes[id];
    if (!node || !box) return;
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
    node.getLayer()?.batchDraw();
  };

  const commit = (id: string, e: KonvaEventObject<Event>) => {
    const box = boxes[id];
    const node = e.target as Konva.Rect;
    if (!box) return;
    // The node is centre-pivoted, so node.x()/y() is the centre; the store wants the unrotated
    // top-left, which is the centre minus half the (scaled) side lengths.
    const w = node.width() * node.scaleX();
    const h = node.height() * node.scaleY();
    const after = clampOriented(
      { x: node.x() - w / 2, y: node.y() - h / 2, w, h, angle: node.rotation() },
      image,
    );
    node.scale({ x: 1, y: 1 });
    node.setAttrs({
      x: after.x + after.w / 2,
      y: after.y + after.h / 2,
      offsetX: after.w / 2,
      offsetY: after.h / 2,
      width: after.w,
      height: after.h,
      rotation: after.angle,
    });
    void onCommitRect(id, orientedRectOf(box), roundOriented(after))
      .catch((err: unknown) => pushLog(`commit rect failed: ${String(err)}`))
      .then(() => syncNode(id));
  };

  return (
    <Layer>
      {list.map((b) => {
        const colour = colourOf(classes, b.class_id);
        const isSelected = b.id === selectedId;
        const proposal = b.review_state === "unreviewed";
        return (
          <Rect
            key={b.id}
            ref={(n) => {
              if (n) nodeRefs.current.set(b.id, n);
              else nodeRefs.current.delete(b.id);
            }}
            name={`box ${b.id}`}
            x={b.x + b.w / 2}
            y={b.y + b.h / 2}
            offsetX={b.w / 2}
            offsetY={b.h / 2}
            width={b.w}
            height={b.h}
            rotation={b.angle}
            stroke={colour}
            strokeWidth={isSelected ? 3 : 2}
            strokeScaleEnabled={false}
            dash={proposal ? [8, 4] : undefined}
            opacity={b.review_state === "rejected" ? 0.35 : 1}
            fill={isSelected || b.id === hoveredId ? `${colour}33` : "rgba(0,0,0,0.01)"}
            // While Space is held the stage pans, so boxes neither capture the pointer nor drag.
            listening={!spaceHeld}
            draggable={!spaceHeld}
            onMouseDown={(e) => {
              // Left button only: a middle press is the pan gesture, and starting it over a box
              // must not also select that box. Konva's own drag is left-only already.
              if (spaceHeld || e.evt.button !== 0) return;
              e.cancelBubble = true;
              select(b.id);
            }}
            onMouseEnter={() => hover(b.id)}
            onMouseLeave={() => hover(null)}
            onDragEnd={(e) => {
              e.cancelBubble = true;
              commit(b.id, e);
            }}
            onTransformEnd={(e) => commit(b.id, e)}
          />
        );
      })}
      {list.map((b) => {
        // A rotated box's unrotated top-left can end up inside or under the shape, so the label
        // hangs off whichever corner is highest on screen.
        const top = cornersOf(orientedRectOf(b)).reduce((a, p) => (p.y < a.y ? p : a));
        return (
          <Text
            key={`label-${b.id}`}
            x={top.x}
            y={top.y - px(14)}
            text={`${nameOf(classes, b.class_id)}${b.confidence !== null ? ` ${Math.round(b.confidence * 100)}%` : ""}`}
            fontSize={px(12)}
            fill={colourOf(classes, b.class_id)}
            listening={false}
          />
        );
      })}
      {draft && (
        <Rect
          x={draft.x}
          y={draft.y}
          width={draft.w}
          height={draft.h}
          stroke={colourOf(classes, draft.classId)}
          strokeWidth={2}
          strokeScaleEnabled={false}
          dash={[4, 4]}
          listening={false}
        />
      )}
      {selectedId && (
        <Transformer
          ref={trRef}
          listening={!spaceHeld}
          rotateEnabled
          rotationSnaps={shiftHeld ? ROTATION_SNAPS : []}
          rotationSnapTolerance={7}
          keepRatio={false}
          ignoreStroke
          anchorSize={8}
          borderEnabled={false}
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < MIN_BOX_SIDE * scale || newBox.height < MIN_BOX_SIDE * scale ? oldBox : newBox
          }
        />
      )}
    </Layer>
  );
}
