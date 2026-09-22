import type { AgentApproval } from "@contract/client";
import { Button } from "@/ui";

/** The action the turn is waiting on; nothing runs until the user approves. */
export function ApprovalCard({
  approval,
  disabled,
  onDecide,
}: {
  approval: AgentApproval;
  disabled: boolean;
  onDecide: (approve: boolean) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Approval needed"
      className="flex flex-col gap-3 rounded-md border border-warn/30 bg-warn-soft px-3 py-3"
    >
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium text-warn">Approval needed</p>
        <p className="text-sm font-semibold text-ink">{approval.title}</p>
        <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-muted">
          {approval.detail}
        </p>
        {approval.estimated_cost !== null && (
          <p className="text-[13px] tabular-nums text-ink">
            Estimated cost <span className="font-medium">≈ ${approval.estimated_cost.toFixed(2)}</span>
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" disabled={disabled} onClick={() => onDecide(false)}>
          Deny
        </Button>
        <Button size="sm" variant="primary" disabled={disabled} onClick={() => onDecide(true)}>
          Approve
        </Button>
      </div>
    </div>
  );
}
