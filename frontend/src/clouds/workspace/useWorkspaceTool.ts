import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { CloudViewerHandle } from "@/clouds/CloudViewer";
import { resolveCloudKey } from "@/clouds/keys";
import { isTypingTarget } from "@/ui";
import { TOOL_OF_ACTION, VIEW_OF_ACTION, navOf, type CloudToolId } from "./tools";
import type { WorkspaceTool } from "./types";

export interface ToolControl {
  active: CloudToolId;
  tool: WorkspaceTool | null;
  arm(id: CloudToolId): void;
  /** Esc (plan Ruling 3). */
  escape(): void;
}

const byId = (tools: readonly WorkspaceTool[], id: CloudToolId) => tools.find((t) => t.id === id) ?? null;

/** Keys inside a dialog or a menu belong to it (its Esc closes it, its Enter presses its button). */
const inOverlay = (t: EventTarget | null) =>
  t instanceof Element && t.closest('[role="dialog"],[role="menu"],[role="listbox"]') !== null;

/**
 * The armed tool and the workspace's keys, resolved through the one keymap (C-X1's resolveCloudKey).
 * Fly keys are V2's (it prevents them in the capture phase); review keys are C-P1's.
 */
export function useWorkspaceTool(o: {
  /** The armed tool: state the caller owns (the features read it as `ctx.activeTool`). */
  active: CloudToolId;
  setActive(id: CloudToolId): void;
  tools: readonly WorkspaceTool[];
  viewer: RefObject<CloudViewerHandle>;
  enabled: boolean;
  isAvailable(id: CloudToolId): boolean;
}): ToolControl {
  const { viewer, active, setActive } = o;
  const latest = useRef({ tools: o.tools, active, isAvailable: o.isAvailable });
  useEffect(() => {
    latest.current = { tools: o.tools, active, isAvailable: o.isAvailable };
  });

  const arm = useCallback(
    (id: CloudToolId) => {
      const now = latest.current;
      if (now.active === id || !now.isAvailable(id)) return;
      byId(now.tools, now.active)?.onDisarm?.();
      now.active = id; // a second key in the same tick sees the new tool
      setActive(id);
      viewer.current?.setNavMode(navOf(id));
      byId(now.tools, id)?.onArm?.();
    },
    [viewer, setActive],
  );

  const escape = useCallback(() => {
    const now = latest.current;
    if (byId(now.tools, now.active)?.onCancel?.()) return;
    if (now.active !== "orbit") arm("orbit");
  }, [arm]);

  useEffect(() => {
    if (!o.enabled) return;
    let held = false;
    const onDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || inOverlay(e.target)) return;
      const now = latest.current;
      const nav = navOf(now.active);
      const key = resolveCloudKey(e, nav);
      if (!key || key.scope === "review" || key.scope === "clouds.fly") return;
      const tool = byId(now.tools, now.active);
      if (key.action === "pan-hold") {
        e.preventDefault();
        if (!held && nav !== "fly") {
          held = true;
          viewer.current?.setNavMode("pan");
        }
        return;
      }
      if (e.repeat) return;
      if (key.action === "cancel") {
        e.preventDefault();
        escape();
        return;
      }
      if (key.action === "commit") {
        if (!tool?.onCommit || e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        if (tool.canCommit !== false) tool.onCommit();
        return;
      }
      if (key.action === "remove-vertex") {
        if (!tool?.onRemoveVertex) return;
        e.preventDefault();
        tool.onRemoveVertex();
        return;
      }
      if (key.action === "fit") {
        e.preventDefault();
        viewer.current?.setView("fit");
        return;
      }
      const view = VIEW_OF_ACTION[key.action];
      if (view) {
        e.preventDefault();
        viewer.current?.setView(view);
        return;
      }
      const id = TOOL_OF_ACTION[key.action];
      if (id) {
        e.preventDefault();
        arm(id);
        return;
      }
      if (tool?.onAction?.(key.action)) e.preventDefault();
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.key !== " " || !held) return;
      held = false;
      viewer.current?.setNavMode(navOf(latest.current.active));
    };
    // Esc in pointer lock is the browser's: leaving the lock while flying returns to Orbit.
    const onLock = () => {
      if (!document.pointerLockElement && latest.current.active === "fly") arm("orbit");
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    document.addEventListener("pointerlockchange", onLock);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      document.removeEventListener("pointerlockchange", onLock);
    };
  }, [o.enabled, viewer, arm, escape]);

  return { active, tool: byId(o.tools, active), arm, escape };
}
