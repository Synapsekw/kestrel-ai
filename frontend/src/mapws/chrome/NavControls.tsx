import { GlassPanel, Icon, IconButton, cx, focusRing, stagger } from "@/ui";
import { useWorkspace } from "../context";
import { zoomPercent } from "../view/siteFrame";

/** North arrow (right 244) and zoom (right 198), bottom 16 (spec §5). */
export function NavControls({ nativeRes }: { nativeRes: number | null }) {
  const api = useWorkspace((s) => s.viewApi);
  const rotation = useWorkspace((s) => s.viewInfo?.rotation ?? 0);
  const resolution = useWorkspace((s) => s.viewInfo?.resolution ?? null);
  const percent = resolution ? zoomPercent(resolution, nativeRes) : null;
  return (
    <>
      <GlassPanel
        variant="float"
        style={stagger(4)}
        className="stagger absolute bottom-4 right-[244px] z-10 grid h-10 w-10 place-items-center rounded-chip animate-rise reduce-motion:animate-none"
      >
        <button
          type="button"
          aria-label="Reset north"
          aria-keyshortcuts="Shift+N"
          title="Reset north · Shift+N"
          onClick={() => api?.resetNorth()}
          className={cx("grid h-full w-full place-items-center rounded-chip text-ink", focusRing)}
        >
          {/* Icon takes no style prop; the wrapper turns with the view (no animation: it follows the map). */}
          <span className="grid place-items-center" style={{ transform: `rotate(${rotation}rad)` }}>
            <Icon name="north" size={18} />
          </span>
        </button>
      </GlassPanel>
      {/* The spec leaves 46 px between the zoom (right 198) and the north arrow (right 244): a vertical
          stack of +, the percentage and −, about 40 px wide. */}
      <GlassPanel
        variant="float"
        role="group"
        aria-label="Zoom"
        style={stagger(3)}
        className="stagger absolute bottom-4 right-[198px] z-10 flex w-10 flex-col items-center gap-0.5 py-1 animate-rise reduce-motion:animate-none"
      >
        <IconButton
          size="sm"
          icon="plus"
          label="Zoom in"
          aria-keyshortcuts="+"
          onClick={() => api?.zoomBy(1)}
        />
        <span className="font-mono text-2xs tabular-nums text-muted">
          {percent === null ? "—" : `${percent}%`}
        </span>
        <IconButton
          size="sm"
          icon="minus"
          label="Zoom out"
          aria-keyshortcuts="-"
          onClick={() => api?.zoomBy(-1)}
        />
      </GlassPanel>
    </>
  );
}
