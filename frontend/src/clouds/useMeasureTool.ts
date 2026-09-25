import { useCallback, useState } from "react";
import type { CloudPick } from "./CloudViewer";
import { pointsNeeded, type MeasureKind } from "./measure";

/** The armed tool and its picks. A click after a complete measurement starts a new one. */
export function useMeasureTool() {
  const [tool, setTool] = useState<MeasureKind | null>(null);
  const [picks, setPicks] = useState<CloudPick[]>([]);
  const [hover, setHover] = useState<CloudPick | null>(null);
  const arm = useCallback((kind: MeasureKind) => {
    setTool(kind);
    setPicks([]);
  }, []);
  const cancel = useCallback(() => {
    setTool(null);
    setPicks([]);
    setHover(null);
  }, []);
  const add = useCallback(
    (p: CloudPick) => {
      if (!tool) return;
      setPicks((ps) => (ps.length >= pointsNeeded(tool) ? [p] : [...ps, p]));
    },
    [tool],
  );
  const complete = tool !== null && picks.length === pointsNeeded(tool);
  return { tool, picks, hover, arm, cancel, add, setHover, complete };
}

export type MeasureTool = ReturnType<typeof useMeasureTool>;
