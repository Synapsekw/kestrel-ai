import { useEffect, useRef, type ReactNode } from "react";
import { Stage, Layer, Image as KonvaImage, Rect } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useEditorStore } from "@/store/editor";
import { ZOOM_STEP } from "./geometry";
import { useKonvaImage } from "./useKonvaImage";

export const BACKGROUND_NAME = "background";

interface Props {
  src: string | null;
  children?: ReactNode;
  onBackgroundMouseDown?: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseMove?: (e: KonvaEventObject<MouseEvent>) => void;
  onMouseUp?: (e: KonvaEventObject<MouseEvent>) => void;
}

/** The stage's world coordinates are image pixels; `view` is the only display transform. */
export function EditorCanvas({ src, children, onBackgroundMouseDown, onMouseMove, onMouseUp }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const image = useEditorStore((s) => s.image);
  const view = useEditorStore((s) => s.view);
  const viewport = useEditorStore((s) => s.viewport);
  const spaceHeld = useEditorStore((s) => s.spaceHeld);
  const setViewport = useEditorStore((s) => s.setViewport);
  const setView = useEditorStore((s) => s.setView);
  const zoomAt = useEditorStore((s) => s.zoomAt);
  const bitmap = useKonvaImage(src);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [setViewport]);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    zoomAt(p, e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  };

  const onDragEnd = (e: KonvaEventObject<DragEvent>) => {
    if (e.target === stageRef.current) setView({ ...view, x: e.target.x(), y: e.target.y() });
  };

  return (
    <div
      ref={containerRef}
      data-testid="editor-canvas"
      data-image={image ? `${image.width}x${image.height}` : ""}
      data-view-scale={view.scale.toFixed(4)}
      data-view-x={view.x.toFixed(1)}
      data-view-y={view.y.toFixed(1)}
      className={`relative h-full w-full overflow-hidden bg-slate-950 ${spaceHeld ? "cursor-grab" : "cursor-crosshair"}`}
    >
      {image && viewport.width > 0 && viewport.height > 0 && (
        <Stage
          ref={stageRef}
          width={viewport.width}
          height={viewport.height}
          scaleX={view.scale}
          scaleY={view.scale}
          x={view.x}
          y={view.y}
          draggable={spaceHeld}
          onDragEnd={onDragEnd}
          onWheel={onWheel}
          onMouseDown={(e) => {
            if (!spaceHeld && e.target.name() === BACKGROUND_NAME) onBackgroundMouseDown?.(e);
          }}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <Layer>
            {bitmap ? (
              <KonvaImage name={BACKGROUND_NAME} image={bitmap} width={image.width} height={image.height} />
            ) : (
              <Rect name={BACKGROUND_NAME} width={image.width} height={image.height} fill="#334155" />
            )}
          </Layer>
          {children}
        </Stage>
      )}
    </div>
  );
}
