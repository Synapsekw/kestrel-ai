import { Button, Dialog } from "@/ui";
import { useAiStore } from "./aiStore";
import { useCommandContext } from "./bridge";
import { cmdReviewSuggestions } from "./review";

/** Shift+A / Shift+X above 20 suggestions (spec §11.4). */
export function BulkConfirm({ projectId }: { projectId: string }) {
  const confirm = useAiStore((s) => s.confirm);
  const ctx = useCommandContext(projectId);
  if (!confirm) return null;
  const verb = confirm.action === "accept" ? "Accept" : "Reject";
  const close = () => useAiStore.getState().closeConfirm();
  return (
    <Dialog
      open
      title={`${verb} ${confirm.ids.length} suggestions?`}
      onClose={close}
      testId="ai-bulk-confirm"
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            Cancel
          </Button>
          <Button
            variant={confirm.action === "accept" ? "primary" : "danger"}
            onClick={() => {
              close();
              void cmdReviewSuggestions(ctx, confirm.ids, confirm.action);
            }}
          >
            {verb} {confirm.ids.length}
          </Button>
        </>
      }
    >
      Every suggestion shown on this image above the threshold is{" "}
      {confirm.action === "accept" ? "accepted" : "rejected"}. Undo puts them back.
    </Dialog>
  );
}
