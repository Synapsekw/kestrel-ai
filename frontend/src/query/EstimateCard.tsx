import type { CostEstimate } from "@contract/client";

const usd = (n: number) => `$${n.toFixed(2)}`;

/** Spec section 8: images x tiles x per-provider cost, shown before "Start". */
export function EstimateCard({ estimate }: { estimate: CostEstimate }) {
  return (
    <p data-testid="estimate" className="rounded border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm">
      {estimate.images} {estimate.images === 1 ? "image" : "images"}, {estimate.tiles} tiles,{" "}
      {estimate.requests} requests, estimated {usd(estimate.estimated_cost)} (at{" "}
      {usd(estimate.cost_per_request)} per request)
    </p>
  );
}
