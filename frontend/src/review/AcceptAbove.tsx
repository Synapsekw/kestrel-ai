import { useId, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { acceptRunAbove } from "@/api/review";
import { pushLog } from "@/app/diagnostics";
import { useOnJobsFinished } from "@/jobs/useOnJobsFinished";
import { Button, Field, Input, toast } from "@/ui";

const DEFAULT_ACCEPT_ABOVE = "0.80";

export interface AcceptAboveProps {
  projectId: string;
  /** A photo run or a map run. */
  runId: string;
  disabled?: boolean;
  /** The `accept_above` job finished: counts and progress changed. */
  onDone?: () => void;
}

/** "Accept all at or above [0.80]": one `accept_above` job for the run, with job progress. */
export function AcceptAbove({ projectId, runId, disabled, onDone }: AcceptAboveProps) {
  const api = useApi();
  const id = useId();
  const [value, setValue] = useState(DEFAULT_ACCEPT_ABOVE);
  const [accepting, setAccepting] = useState(false);
  const threshold = Number(value);
  const valid = value.trim() !== "" && threshold >= 0 && threshold <= 1;

  useOnJobsFinished("accept_above", () => {
    setAccepting(false);
    onDone?.();
  });

  return (
    <div className="flex flex-col gap-2">
      <Field
        label="Minimum confidence"
        htmlFor={id}
        hint="Accepts every detection not yet reviewed at or above this confidence."
        error={valid ? undefined : "Enter a number from 0 to 1."}
      >
        <Input
          id={id}
          dense
          type="number"
          min={0}
          max={1}
          step={0.05}
          value={value}
          invalid={!valid}
          onChange={(e) => setValue(e.target.value)}
        />
      </Field>
      <Button
        size="sm"
        loading={accepting}
        disabled={!valid || disabled}
        onClick={() => {
          setAccepting(true);
          void acceptRunAbove(api, projectId, runId, threshold)
            .then(() => toast("info", `Accepting detections at or above ${Math.round(threshold * 100)}%`))
            .catch((err: unknown) => {
              setAccepting(false);
              const message = messageOf(err, "could not accept detections");
              pushLog(`accept above failed: ${message}`);
              toast("danger", message);
            });
        }}
      >
        Accept all at or above
      </Button>
    </div>
  );
}
