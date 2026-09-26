import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Dialog, Kbd } from "@/ui";
import { formatChord, isTypingTarget, keysFor } from "@/ui/keymap";
import { routeInfo, sheetScope } from "./routeModel";

/** The `?` sheet (spec 2026-09-26-foundation section 5.6): DS's keymap table for this screen. */
export function ShortcutSheet() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const entries = keysFor(sheetScope(routeInfo(pathname)));
  return (
    <Dialog open={open} title="Keyboard shortcuts" onClose={() => setOpen(false)} width="lg">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-1 pr-4 font-medium">Keys</th>
            <th className="py-1 font-medium">Action</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={`${e.scope}:${e.action}`} className="border-t border-line">
              <td className="py-1.5 pr-4">
                <span className="inline-flex flex-wrap gap-1">
                  {e.keys.map((chord) => (
                    <span key={chord} className="inline-flex gap-0.5">
                      {formatChord(chord).map((part) => (
                        <Kbd key={part}>{part}</Kbd>
                      ))}
                    </span>
                  ))}
                </span>
              </td>
              <td className="py-1.5">{e.help}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}
