import { useEffect } from "react";
import type { ClassDef } from "@contract/client";
import { useEditorStore } from "@/store/editor";
import { actionForKey, isTypingTarget } from "./hotkeys";
import type { EditorActions } from "./useEditorActions";

interface Options {
  enabled: boolean;
  classes: ClassDef[];
  actions: EditorActions;
  nav?: { next: () => void; prev: () => void };
}

/** Document-level hotkeys for the editor (spec section 6); typing targets are left alone. */
export function useEditorHotkeys({ enabled, classes, actions, nav }: Options): void {
  useEffect(() => {
    if (!enabled) return;
    const handle = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const action = actionForKey({
        type: e.type === "keyup" ? "keyup" : "keydown",
        key: e.key,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        repeat: e.repeat,
      });
      if (!action) return;
      const st = useEditorStore.getState();
      switch (action.type) {
        case "class-key": {
          const cls = classes.find((c) => c.hotkey === action.key);
          if (!cls) return;
          e.preventDefault();
          st.setActiveClass(cls.id);
          if (st.selectedId) void actions.setClass(st.selectedId, cls.id);
          return;
        }
        case "space-down":
          e.preventDefault();
          st.setSpaceHeld(true);
          return;
        case "space-up":
          e.preventDefault();
          st.setSpaceHeld(false);
          return;
        case "escape":
          st.select(null);
          st.setDraft(null);
          return;
        case "fit":
          st.fit();
          return;
        case "one-to-one":
          e.preventDefault();
          st.oneToOne();
          return;
        case "delete":
          e.preventDefault();
          void actions.deleteSelected();
          return;
        case "duplicate":
          e.preventDefault();
          void actions.duplicateSelected();
          return;
        case "accept-all":
          void actions.acceptAll();
          return;
        case "reject-all":
          void actions.rejectAll();
          return;
        case "undo":
          e.preventDefault();
          void actions.undo();
          return;
        case "redo":
          e.preventDefault();
          void actions.redo();
          return;
        case "next":
          e.preventDefault();
          nav?.next();
          return;
        case "prev":
          e.preventDefault();
          nav?.prev();
          return;
      }
    };
    document.addEventListener("keydown", handle);
    document.addEventListener("keyup", handle);
    return () => {
      document.removeEventListener("keydown", handle);
      document.removeEventListener("keyup", handle);
      useEditorStore.getState().setSpaceHeld(false);
    };
  }, [enabled, classes, actions, nav]);
}
