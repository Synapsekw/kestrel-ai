import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/ui";
import { useWorkspace } from "../context";
import { useOpenIn3d } from "../threeD";

/**
 * The stage's right-click menu (port of maps/MapContextMenu.tsx): "Open this spot in 3D", disabled with
 * the reason when no cloud of the r survey covers the spot. Opaque `bg-glass-solid` (DESIGN.md: a map
 * overlay that is not GlassPanel). Esc and a click elsewhere close it.
 */
export function StageMenu() {
  const menu = useWorkspace((s) => s.stageMenu);
  const close = useWorkspace((s) => s.closeStageMenu);
  const openIn3d = useOpenIn3d();
  const navigate = useNavigate();
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault(); // the workspace's Esc (cancel/deselect) skips a handled key
      close();
    };
    const onDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest("[data-stage-menu]"))) close();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [menu, close]);
  if (!menu) return null;
  const jump = openIn3d(menu.coord[0], menu.coord[1]);
  return (
    <div
      role="menu"
      aria-label="Map"
      data-stage-menu=""
      className="fixed z-20 flex min-w-48 flex-col gap-0.5 rounded-control border border-line bg-glass-solid p-1 shadow-elev-2"
      style={{ left: menu.x, top: menu.y }}
    >
      <Button
        role="menuitem"
        size="sm"
        variant="ghost"
        icon="cloud"
        disabled={jump.href === null}
        onClick={() => {
          if (!jump.href) return;
          close();
          navigate(jump.href);
        }}
      >
        Open this spot in 3D
      </Button>
      {jump.href === null && <p className="max-w-64 px-2 py-1 text-2xs text-muted">{jump.reason}</p>}
    </div>
  );
}
