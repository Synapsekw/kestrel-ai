import { Progress } from "@/ui";
import { useSamStore } from "./sam/useSmartPolygon";

/**
 * A thin edge on the canvas top while the embedding is computed; the loop is tied to the open
 * `segment/prepare` request (A6) and Progress's indeterminate bar stops under reduced motion.
 */
export function SamWarmEdge() {
  const preparing = useSamStore((s) => s.state.status === "preparing");
  if (!preparing) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10" data-testid="sam-warm-edge">
      <Progress running thin label="Preparing the smart polygon" className="rounded-none" />
    </div>
  );
}
