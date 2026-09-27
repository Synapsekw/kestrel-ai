import type { FindingDetail } from "@/api/findings";
import { formatFindingNumber } from "@/findings/format";
import { useImagesWorkspace } from "@/store/imagesWorkspace";
import { Button, Dialog } from "@/ui";
import { confirmDelete, confirmRetype } from "./actions";
import type { CommandContext } from "./commands";

/** FC-R5's wording, naming the finding(s) the change deletes when they could be read. */
function retypeText(findings: readonly Pick<FindingDetail, "number">[]): string {
  const numbers = findings.map((f) => formatFindingNumber(f.number));
  if (numbers.length === 0)
    return "Objects are counted, not reported, so the finding on this shape is deleted with its note, photos and comments.";
  if (numbers.length === 1) return `The finding ${numbers[0]} is deleted with its note, photos and comments.`;
  return `The findings ${numbers.join(", ")} are deleted with their notes, photos and comments.`;
}

/** The delete (FC-R4) and retype (FC-R5) confirmations. */
export function CanvasDialogs({ ctx }: { ctx: CommandContext }) {
  const confirm = useImagesWorkspace((s) => s.confirm);
  const close = () => ctx.store.getState().setConfirm(null);
  if (!confirm) return null;
  if (confirm.kind === "delete") {
    const n = confirm.ids.length;
    const numbers = confirm.findings.map((f) => formatFindingNumber(f.number)).join(", ");
    const which = numbers
      ? `${numbers} ${confirm.findings.length === 1 ? "has" : "have"} a note, photos or comments.`
      : "Its finding could not be read, so it may have a note, photos or comments.";
    return (
      <Dialog
        open
        title={n === 1 ? "Delete this shape?" : `Delete ${n} shapes?`}
        onClose={close}
        footer={
          <>
            <Button variant="ghost" onClick={close}>
              Keep
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete(ctx)}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">
          {which} Deleting the shape deletes its finding; undo brings the shape back but not the
          finding&apos;s note, photos or comments.
        </p>
      </Dialog>
    );
  }
  return (
    <Dialog
      open
      title="Change to an object type?"
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Keep the finding
          </Button>
          <Button variant="danger" onClick={() => void confirmRetype(ctx)}>
            Change type
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">{retypeText(confirm.findings ?? [])}</p>
    </Dialog>
  );
}
