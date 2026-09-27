/* eslint-disable react-refresh/only-export-components --
   createIdleMarker, pointerFrom and LAYER_NAMES are part of the canvas API (plan interfaces). */
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { Image as KonvaImage, Layer, Rect, Stage } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { ClassDef } from "@contract/client";
import type { BoxWriteResult } from "@/api/shapes";
import { ensureBuiltInTools } from "@/images/tools";
import { getTool } from "@/images/tools/registry";
import { lastPointer, makeToolApi } from "@/images/tools/toolApi";
import { TypePicker } from "@/images/tools/TypePicker";
import type { ToolApi, ToolPointer } from "@/images/tools/types";
import { useImagesWorkspace, type ImagesWorkspaceStore } from "@/store/imagesWorkspace";
import { cx } from "@/ui/tokens";
import { dur } from "@/ui/motion";
import { CanvasDialogs } from "./CanvasDialogs";
import { tokenColour } from "./colours";
import { useCommandContext } from "./commands";
import { IDLE_AFTER_MS, LAYER_NAMES } from "./constants";
import { toImage, ZOOM_STEP, type Point, type Rect as RectT, type ViewTransform } from "./geometry";
import { InteractionLayer } from "./InteractionLayer";
import { ShapeLayer } from "./ShapeLayer";
import { useTwoLevelImage } from "./useTwoLevelImage";

export { LAYER_NAMES } from "./constants";

ensureBuiltInTools();

/** `MouseEvent.button` for the middle button; left is 0. */
const MIDDLE_BUTTON = 1;

export interface ImageCanvasProps {
  projectId: string;
  types: readonly ClassDef[];
  imageUrl: (imageId: string, maxSide: number | null) => string;
  neighbourIds?: readonly string[];
  suggestions?: ReactNode;
  overlay?: ReactNode;
  children?: ReactNode;
  onShapeCreated?: (result: BoxWriteResult) => void;
  className?: string;
}

export interface ImageCanvasHandle {
  centreOn(point: Point, opts?: { radiusPx?: number; animate?: boolean }): void;
  panIntoView(rect: RectT, opts?: { animate?: boolean }): void;
  fit(): void;
  stage(): Konva.Stage | null;
}

/** Sets `interacting` now and clears it `ms` after the last call (spec §9.1: 120 ms). */
export function createIdleMarker(
  store: ImagesWorkspaceStore,
  ms = IDLE_AFTER_MS,
): { mark(): void; dispose(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return {
    mark() {
      store.getState().setInteracting(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        store.getState().setInteracting(false);
      }, ms);
    },
    dispose() {
      if (timer) clearTimeout(timer);
    },
  };
}

export function pointerFrom(
  pos: Point,
  view: ViewTransform,
  evt: { shiftKey: boolean; altKey: boolean; button: number },
): ToolPointer {
  return { image: toImage(pos, view), screen: pos, shift: evt.shiftKey, alt: evt.altKey, button: evt.button };
}

/**
 * The Images canvas (spec §9.1): stage world coordinates are stored-image pixels; four layers —
 * the image (never listening), accepted shapes, suggestions (FA's slot), and interaction (drafts,
 * handles, FW's overlay). Children float as HTML over the canvas.
 */
export const ImageCanvas = forwardRef<ImageCanvasHandle, ImageCanvasProps>(function ImageCanvas(props, ref) {
  const {
    projectId,
    types,
    imageUrl,
    neighbourIds,
    suggestions,
    overlay,
    children,
    onShapeCreated,
    className,
  } = props;
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const imageRef = useRef<Konva.Image>(null);
  const ctx = useCommandContext(projectId);
  const created = useRef(onShapeCreated);
  useEffect(() => {
    created.current = onShapeCreated;
  });
  const api = useMemo<ToolApi>(() => {
    const base = makeToolApi(ctx);
    return {
      ...base,
      createShape: async (body) => {
        const box = await base.createShape(body);
        if (box) created.current?.(box);
        return box;
      },
    };
  }, [ctx]);

  const image = useImagesWorkspace((s) => s.image);
  const view = useImagesWorkspace((s) => s.view);
  const viewport = useImagesWorkspace((s) => s.viewport);
  const spaceHeld = useImagesWorkspace((s) => s.spaceHeld);
  const tool = useImagesWorkspace((s) => s.tool);
  const interacting = useImagesWorkspace((s) => s.interacting);
  const showSuggestions = useImagesWorkspace((s) => s.showSuggestions);
  const shapeCount = useImagesWorkspace((s) =>
    s.order.reduce((n, id) => n + (s.boxes[id] && s.boxes[id].review_state !== "rejected" ? 1 : 0), 0),
  );
  const panMode = spaceHeld || tool === "pan";
  const idle = useMemo(() => createIdleMarker(useImagesWorkspace), []);
  useEffect(() => () => idle.dispose(), [idle]);

  useEffect(() => {
    const s = useImagesWorkspace.getState();
    s.setProject(projectId);
    s.setTypes(types);
  }, [projectId, types]);

  const { bitmap } = useTwoLevelImage({
    imageId: image?.id ?? null,
    width: image?.width ?? 0,
    height: image?.height ?? 0,
    scale: view.scale,
    url: imageUrl,
    neighbourIds,
  });

  // The new frame fades in on an image change only, never on the preview → full swap (FC-R9).
  const fadedFor = useRef<string | null>(null);
  useEffect(() => {
    const node = imageRef.current;
    if (!node || !bitmap || !image || fadedFor.current === image.id) return;
    fadedFor.current = image.id;
    node.opacity(0);
    node.to({ opacity: 1, duration: dur.fast / 1000 });
  }, [bitmap, image]);

  useImperativeHandle(
    ref,
    () => ({
      centreOn: (point, opts) => useImagesWorkspace.getState().centreOn(point, opts),
      panIntoView: (rect, opts) => useImagesWorkspace.getState().panIntoView(rect, opts),
      fit: () => useImagesWorkspace.getState().fit(),
      stage: () => stageRef.current,
    }),
    [],
  );

  /**
   * Middle-button panning, deliberately not routed through Konva's `draggable`: Konva decides
   * whether a node is draggable at mousedown, so flipping a React flag in that same event lands
   * a render too late and the first drag is always dead. Space + left drag still pans the stage.
   * (Kept from editor/EditorCanvas.tsx, ruling FC-R1.)
   */
  const panStart = useRef<{ x: number; y: number; view: ViewTransform } | null>(null);
  const [panning, setPanning] = useState(false);

  const startPan = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.button !== MIDDLE_BUTTON || !image) return;
    // Chromium - and so WebView2 in the packaged app - starts autoscroll on a middle press.
    e.preventDefault();
    panStart.current = { x: e.clientX, y: e.clientY, view: useImagesWorkspace.getState().view };
    setPanning(true);
  };

  // The listeners live on `window` for the length of the drag, so a pan that wanders off the
  // canvas keeps tracking and one released outside it still ends.
  useEffect(() => {
    if (!panning) return;
    const move = (e: MouseEvent) => {
      const start = panStart.current;
      if (!start) return;
      idle.mark();
      useImagesWorkspace.getState().setView({
        ...start.view,
        x: start.view.x + (e.clientX - start.x),
        y: start.view.y + (e.clientY - start.y),
      });
    };
    const stop = () => {
      panStart.current = null;
      setPanning(false);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
    };
  }, [panning, idle]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () =>
      useImagesWorkspace.getState().setViewport({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const p = stageRef.current?.getPointerPosition();
    if (!p) return;
    idle.mark();
    useImagesWorkspace.getState().zoomAt(p, e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  };

  const route = (kind: "down" | "move" | "up", e: KonvaEventObject<MouseEvent>) => {
    const pos = stageRef.current?.getPointerPosition();
    if (!pos) return;
    if (kind === "move") lastPointer.current = pos;
    const s = useImagesWorkspace.getState();
    if (kind === "down" && (s.spaceHeld || s.tool === "pan" || e.evt.button === MIDDLE_BUTTON)) return;
    const def = getTool(s.tool);
    if (!def) return;
    // A press on a shape in the select tool was handled (and cancelBubble'd) by the shape itself.
    const p = pointerFrom(pos, s.view, e.evt);
    if (kind === "down") def.onDown?.(p, api);
    else if (kind === "move") def.onMove?.(p, api);
    else def.onUp?.(p, api);
  };

  const cursor = panning
    ? "cursor-grabbing"
    : panMode
      ? "cursor-grab"
      : getTool(tool)?.cursor === "crosshair"
        ? "cursor-crosshair"
        : "cursor-default";

  return (
    <div
      ref={containerRef}
      data-testid="image-canvas"
      data-image={image ? `${image.width}x${image.height}` : ""}
      data-view-scale={view.scale.toFixed(4)}
      data-view-x={view.x.toFixed(1)}
      data-view-y={view.y.toFixed(1)}
      data-tool={tool}
      data-shape-count={shapeCount}
      data-interacting={interacting ? "true" : "false"}
      onMouseDown={startPan}
      className={cx("relative h-full w-full overflow-hidden bg-bg", cursor, className)}
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
          draggable={panMode}
          onDragMove={(e: KonvaEventObject<DragEvent>) => {
            if (e.target === stageRef.current) idle.mark();
          }}
          onDragEnd={(e: KonvaEventObject<DragEvent>) => {
            if (e.target !== stageRef.current) return;
            const v = useImagesWorkspace.getState().view;
            useImagesWorkspace.getState().setView({ ...v, x: e.target.x(), y: e.target.y() });
          }}
          onWheel={onWheel}
          onMouseDown={(e: KonvaEventObject<MouseEvent>) => route("down", e)}
          onMouseMove={(e: KonvaEventObject<MouseEvent>) => route("move", e)}
          onMouseUp={(e: KonvaEventObject<MouseEvent>) => route("up", e)}
          onMouseLeave={(e: KonvaEventObject<MouseEvent>) => route("up", e)}
        >
          <Layer name={LAYER_NAMES.image} listening={false}>
            {bitmap ? (
              <KonvaImage
                ref={imageRef}
                image={bitmap}
                width={image.width}
                height={image.height}
                listening={false}
              />
            ) : (
              <Rect
                width={image.width}
                height={image.height}
                fill={tokenColour("glass-solid")}
                listening={false}
              />
            )}
          </Layer>
          <ShapeLayer ctx={ctx} />
          <Layer
            name={LAYER_NAMES.suggestions}
            listening={!interacting && !panMode}
            visible={showSuggestions}
          >
            {suggestions}
          </Layer>
          <InteractionLayer ctx={ctx} overlay={overlay} />
        </Stage>
      )}
      <TypePicker ctx={ctx} />
      <CanvasDialogs ctx={ctx} />
      {children}
    </div>
  );
});
