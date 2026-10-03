import { useCallback, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";
import { Button, Dialog } from "@/ui";

/**
 * Spec §11 "unsaved edits prompt before they are dropped": `guard(action)` runs the action at once
 * when nothing is unsaved, else asks first; leaving the route asks too (react-router's blocker, so
 * this needs the app's data router).
 */
export function useDiscardGuard(
  dirty: boolean,
  name: string,
): { guard(action: () => void): void; dialog: ReactNode } {
  const [pending, setPending] = useState<(() => void) | null>(null);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname,
  );
  const guard = useCallback(
    (action: () => void) => {
      if (dirty) setPending(() => action);
      else action();
    },
    [dirty],
  );
  const blocked = blocker.state === "blocked";
  const asking = pending !== null || blocked;
  const keep = () => {
    setPending(null);
    if (blocked) blocker.reset();
  };
  const discard = () => {
    const action = pending;
    setPending(null);
    if (blocked) blocker.proceed();
    else action?.();
  };
  const dialog = (
    <Dialog
      open={asking}
      title={`Discard your changes to ${name}?`}
      onClose={keep}
      footer={
        <>
          <Button variant="ghost" onClick={keep}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={discard}>
            Discard changes
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted">Your edits are not saved as a version yet.</p>
    </Dialog>
  );
  return { guard, dialog };
}
