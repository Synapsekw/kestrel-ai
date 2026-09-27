import { ZOOM_STEP } from "@/images/canvas/geometry";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { cx, FloatingToolbar, MenuButton, ToolButton, ToolSeparator } from "@/ui";

/** Top-right of the canvas (spec §6.2): −, a mono %, +, Fit, and the Keep zoom / 1:1 menu. */
export function ZoomCluster({ className }: { className?: string }) {
  const scale = useImagesWorkspace((s) => s.view.scale);
  const keepZoom = useImagesWorkspace((s) => s.keepZoom);
  const st = useImagesWorkspace.getState;
  return (
    <FloatingToolbar
      label="Zoom"
      orientation="horizontal"
      shortcuts={false}
      className={cx(className)}
      tools={[
        {
          id: "out",
          icon: "minus",
          label: "Zoom out",
          shortcut: "-",
          action: "zoom-out",
          onClick: () => st().zoomBy(1 / ZOOM_STEP),
        },
      ]}
    >
      <span className="w-12 text-center font-mono text-2xs tabular-nums" aria-live="polite">
        {Math.round(scale * 100)}%
      </span>
      <ToolButton
        icon="plus"
        label="Zoom in"
        shortcut="+"
        tooltipSide="bottom"
        onClick={() => st().zoomBy(ZOOM_STEP)}
      />
      <ToolSeparator orientation="horizontal" />
      <ToolButton icon="fit" label="Fit" shortcut="F" tooltipSide="bottom" onClick={() => st().fit()} />
      <MenuButton
        label="Zoom options"
        iconOnly
        variant="ghost"
        size="sm"
        align="end"
        items={[
          {
            id: "keep",
            label: "Keep zoom between images",
            icon: keepZoom ? "check" : undefined,
            onSelect: () => st().setKeepZoom(!keepZoom),
          },
          {
            id: "one",
            label: "Actual size",
            shortcut: "Ctrl+1",
            icon: "one-to-one",
            onSelect: () => st().oneToOne(),
          },
        ]}
      />
    </FloatingToolbar>
  );
}
