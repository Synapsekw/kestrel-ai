import { useEffect, useRef, type RefObject } from "react";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { cloudShortcut } from "@/clouds/keys";
import type { ViewName } from "@/clouds/viewer/types";
import { Button, GlassPanel, Tooltip, cx, stagger } from "@/ui";
import { ISO_DIRECTION, VIEW_OF_AXIS, gizmoAxes } from "./gizmo";
import { GIZMO_LEFT, GIZMO_WIDTH } from "./layout";

const SIZE = 64;
const C = SIZE / 2;
const R = 22;
const AXES = ["x", "y", "z"] as const;
/** X (E) pink, Y (N) blue, Z (up) teal (spec §6), as the danger, info and ok tokens. */
const TONE = { x: "stroke-danger fill-danger", y: "stroke-info fill-info", z: "stroke-ok fill-ok" } as const;
const NAME = {
  x: "Side view (look from the east)",
  y: "Front view (look from the south)",
  z: "Top view (look from above)",
} as const;
const VIEWS: [ViewName, string, string][] = [
  ["top", "Top", cloudShortcut("view-top")],
  ["front", "Front", cloudShortcut("view-front")],
  ["side", "Side", cloudShortcut("view-side")],
  ["iso", "Iso", cloudShortcut("view-iso")],
];

/**
 * The view gizmo (spec §6: left 72, bottom 14, 64 px axes; the panel is `GIZMO_WIDTH` wide). Redrawn in the frame hook by attribute
 * writes (never a React render per frame); idle when the render loop is.
 */
export function Gizmo({ viewer, running }: { viewer: RefObject<CloudViewerHandle>; running: boolean }) {
  const lines = useRef<Partial<Record<(typeof AXES)[number], SVGLineElement | null>>>({});
  const heads = useRef<Partial<Record<(typeof AXES)[number], SVGGElement | null>>>({});

  useEffect(() => {
    const draw = (dir: readonly number[]) => {
      for (const a of gizmoAxes([dir[0], dir[1], dir[2]], R)) {
        const line = lines.current[a.axis];
        const head = heads.current[a.axis];
        line?.setAttribute("x2", String(C + a.dx));
        line?.setAttribute("y2", String(C + a.dy));
        line?.setAttribute("opacity", a.away ? "0.45" : "1");
        head?.setAttribute("transform", `translate(${C + a.dx} ${C + a.dy})`);
        head?.setAttribute("opacity", a.away ? "0.45" : "1");
      }
    };
    draw(ISO_DIRECTION);
    const v = viewer.current;
    if (!running || !v) return;
    return v.onFrame((cam) => draw(cam.direction));
  }, [viewer, running]);

  const go = (view: ViewName) => viewer.current?.setView(view);
  return (
    <GlassPanel
      variant="float"
      radius="panel"
      data-testid="cloud-gizmo"
      style={{ ...stagger(3), left: GIZMO_LEFT, width: GIZMO_WIDTH }}
      className="stagger absolute bottom-3.5 z-10 flex items-center gap-2 p-2 animate-reveal reduce-motion:animate-none"
    >
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-label="View axes" role="group">
        {AXES.map((ax) => (
          <line
            key={ax}
            ref={(el) => {
              lines.current[ax] = el;
            }}
            x1={C}
            y1={C}
            x2={C}
            y2={C}
            strokeWidth={2}
            strokeLinecap="round"
            className={TONE[ax]}
          />
        ))}
        {AXES.map((ax) => (
          <g
            key={ax}
            ref={(el) => {
              heads.current[ax] = el;
            }}
            role="button"
            tabIndex={0}
            aria-label={NAME[ax]}
            className="group cursor-pointer outline-none"
            onClick={() => go(VIEW_OF_AXIS[ax])}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                go(VIEW_OF_AXIS[ax]);
              }
            }}
          >
            {/* The keyboard focus indicator (the head's own outline is off: an SVG <g> draws none). */}
            <circle
              data-focus-ring
              r={10}
              strokeWidth={2}
              className="fill-none stroke-accent opacity-0 group-focus-visible:opacity-100"
            />
            <circle r={7} className={cx(TONE[ax], "stroke-0")} />
            <text
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-bg font-mono text-2xs font-semibold"
            >
              {ax.toUpperCase()}
            </text>
          </g>
        ))}
      </svg>
      <div className="grid flex-1 grid-cols-2 gap-1">
        {VIEWS.map(([view, label, chord]) => (
          <Tooltip key={view} label={`${label} view`} shortcut={chord} side="top">
            <Button size="sm" variant="secondary" onClick={() => go(view)}>
              {label}
            </Button>
          </Tooltip>
        ))}
      </div>
    </GlassPanel>
  );
}
