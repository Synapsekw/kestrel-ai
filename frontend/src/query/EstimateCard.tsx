import type { CostEstimate } from "@contract/client";
import { Icon } from "@/ui";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Spec section 8: images x tiles x per-provider cost, shown before "Start". A local model costs nothing. */
export function EstimateCard({ estimate, local }: { estimate: CostEstimate; local: boolean }) {
  const size = `${estimate.images} ${estimate.images === 1 ? "image" : "images"}, ${estimate.tiles} tiles`;
  return (
    <p
      data-testid="estimate"
      className="flex items-center gap-2 rounded-md bg-surface-2 px-3 py-2 text-[13px] tabular-nums text-muted animate-reveal reduce-motion:animate-none"
    >
      <Icon name="info" size={14} className="shrink-0" />
      {local
        ? `${size}. Runs on this computer's GPU: no cost, nothing leaves the machine.`
        : `${size}, ${estimate.requests} requests, estimated ${usd(estimate.estimated_cost)} (at ${usd(estimate.cost_per_request)} per request)`}
    </p>
  );
}
