import { useEffect, useMemo, useRef } from "react";
import { Layer, Rect, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { ClassDef } from "@contract/client";
import { pushLog } from "@/app/diagnostics";
import { useEditorStore, visibleBoxes } from "@/store/editor";
import { clampRect, MIN_BOX_SIDE, rectOf, roundRect, type Rect as RectShape } from "./geometry";
import { colourOf, nameOf } from "./labels";

interface Props {
  classes: ClassDef[];
  /** Resolves when the move/resize has been saved or has failed; the node is re-synced from the store then. */
  onCommitRect: (id: string, before: RectShape, after: RectShape) => Promise<void>;
}

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

  /** The Konva node follows the store again: the saved rect on success, the old rect on failure. */
  const syncNode = (id: string) => {
    const node = nodeRefs.current.get(id);
    const box = useEditorStore.getState().boxes[id];
    if (!node || !box) return;
    node.scale({ x: 1, y: 1 });
    node.setAttrs({ x: box.x, y: box.y, width: box.w, height: box.h });
    node.getLayer()?.batchDraw();
  };

  const commit = (id: string, e: KonvaEventObject<Event>) => {
    const box = boxes[id];
    const node = e.target as Konva.Rect;
    if (!box) return;
    const after = clampRect(
      { x: node.x(), y: node.y(), w: node.width() * node.scaleX(), h: node.height() * node.scaleY() },
      image,
    );
    node.scale({ x: 1, y: 1 });
    node.setAttrs({ x: after.x, y: after.y, width: after.w, height: after.h });
    void onCommitRect(id, rectOf(box), roundRect(after))
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
            x={b.x}
            y={b.y}
            width={b.w}
            height={b.h}
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
              if (spaceHeld) return;
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
      {list.map((b) => (
        <Text
          key={`label-${b.id}`}
          x={b.x}
          y={b.y - px(14)}
          text={`${nameOf(classes, b.class_id)}${b.confidence !== null ? ` ${Math.round(b.confidence * 100)}%` : ""}`}
          fontSize={px(12)}
          fill={colourOf(classes, b.class_id)}
          listening={false}
        />
      ))}
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
          rotateEnabled={false}
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
