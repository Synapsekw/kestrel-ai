import { Button, Dialog } from "@/ui";
import type { PendingConfirm } from "./useReview";

const VERB = {
  reject: "Rejecting",
  unreview: "Resetting",
  reclass: "Changing the type of",
  accept: "Accepting",
} as const;

/** F's finding-delete confirm (spec §9.3, §14). Nothing is deleted until Delete is pressed. */
export function ConfirmFindingDelete({
  confirm,
  onConfirm,
  onCancel,
}: {
  confirm: PendingConfirm | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const n = confirm?.findingIds.length ?? 0;
  return (
    <Dialog
      open={confirm !== null}
      title={n > 1 ? `Delete ${n} findings?` : "Delete finding?"}
      onClose={onCancel}
      testId="confirm-finding-delete"
      footer={
        <>
          <Button onClick={onCancel}>Keep it</Button>
          <Button variant="danger" onClick={onConfirm}>
            {n > 1 ? "Delete findings" : "Delete finding"}
          </Button>
        </>
      }
    >
      <p className="text-sm text-ink">
        {confirm ? VERB[confirm.action] : ""} this detection deletes the {n > 1 ? "findings" : "finding"} made
        from it, with {n > 1 ? "their" : "its"} comments and photos. The detection stays, marked as reviewed.
      </p>
    </Dialog>
  );
}
