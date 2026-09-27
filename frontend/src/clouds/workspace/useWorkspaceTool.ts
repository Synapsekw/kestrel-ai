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

/** Controls that activate on Space themselves (the panels all sit inside `cloud-centre`). */
const INTERACTIVE =
  'button,a[href],input,select,textarea,[role="button"],[role="switch"],[role="tab"],[role="radio"],[role="slider"],[role="menuitem"],[role="checkbox"],[role="option"]';

/**
 * Space belongs to the viewer only when nothing else has focus (the body) or focus is inside the
 * viewer itself and not on one of its controls; a focused button, switch, tab or slider anywhere
 * (the glass panels included) keeps Space for itself (mirrors the images workspace's `canvasOwnsSpace`).
 */
const viewerOwnsSpace = (t: EventTarget | null) =>
  !(t instanceof Element) ||
  t === document.body ||
  (t.closest('[data-testid="cloud-viewer"]') !== null && t.closest(INTERACTIVE) === null);

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
    // The key that started the pan hold (its keyup ends it); null while no hold is on.
    let held: string | null = null;
    const release = () => {
      if (held === null) return;
      held = null;
      viewer.current?.setNavMode(navOf(latest.current.active));
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isTypingTarget(e.target) || inOverlay(e.target)) return;
      const now = latest.current;
      const nav = navOf(now.active);
      const key = resolveCloudKey(e, nav);
      if (!key || key.scope === "review" || key.scope === "clouds.fly") return;
      const tool = byId(now.tools, now.active);
      if (key.action === "pan-hold") {
        if (!viewerOwnsSpace(e.target)) return;
        e.preventDefault();
        if (held === null && nav !== "fly") {
          held = e.code || e.key;
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
      if (held !== null && (e.code || e.key) === held) release();
    };
    // Esc in pointer lock is the browser's: leaving the lock while flying returns to Orbit.
    const onLock = () => {
      if (!document.pointerLockElement && latest.current.active === "fly") arm("orbit");
    };
    // C-V2's lookThrough (a photo pose) leaves fly without a word: after the frame it draws, a Fly tool
    // over an engine that no longer flies returns to Orbit, so the palette never shows Fly while orbiting.
    const stopFrames = viewer.current?.onFrame?.(() => {
      if (latest.current.active === "fly" && viewer.current?.navMode() !== "fly") arm("orbit");
    });
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    // Alt+Tab mid-hold: the keyup goes to another window, so the hold ends with the focus.
    window.addEventListener("blur", release);
    document.addEventListener("pointerlockchange", onLock);
    return () => {
      stopFrames?.();
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
      document.removeEventListener("pointerlockchange", onLock);
    };
  }, [o.enabled, viewer, arm, escape]);

  return { active, tool: byId(o.tools, active), arm, escape };
}
