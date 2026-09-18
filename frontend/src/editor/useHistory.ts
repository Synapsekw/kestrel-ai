import { useMemo } from "react";
import { History } from "./history";

/** Undo and redo are per image (spec section 6): a new stack whenever the image id changes. */
export function useHistory(imageId: string): History {
  const entry = useMemo(() => ({ imageId, history: new History() }), [imageId]);
  return entry.history;
}
