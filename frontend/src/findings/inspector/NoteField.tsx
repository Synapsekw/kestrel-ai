import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { patchFinding } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { Textarea, toast } from "@/ui";
import { formatFindingNumber } from "../format";
import { useAutosave } from "./useAutosave";

const LABEL = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved. Keep typing to retry.",
} as const;

/**
 * F §8.7 item 7. Mounted with `key={findingId}`: it reads `initial` once, so a refetch never
 * overwrites what the operator is typing, and its save is bound to its own finding. A save that
 * fails after the field is gone (the flush on switch, or a save in flight) can no longer show its
 * inline state, so it says so in a toast and keeps the text in the diagnostics log.
 */
export function NoteField({
  projectId,
  findingId,
  initial,
  number,
}: {
  projectId: string;
  findingId: string;
  initial: string;
  /** The finding's number, for the message when a save fails after a switch. */
  number?: number;
}) {
  const api = useApi();
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const save = useCallback(
    async (v: string) => {
      try {
        await patchFinding(api, projectId, findingId, { note: v });
      } catch (e) {
        if (!mounted.current) {
          const name = number === undefined ? "the previous finding" : formatFindingNumber(number);
          pushLog(
            `note on ${name} (${findingId}) not saved: ${messageOf(e, String(e))}; text: ${JSON.stringify(v)}`,
          );
          toast("danger", `Note on ${name} was not saved: ${messageOf(e, "the save failed")}`);
        }
        throw e;
      }
      setSaved(v);
      useChangesStore.getState().bumpFindings();
    },
    [api, projectId, findingId, number],
  );
  const state = useAutosave(text, saved, save);
  return (
    <div className="flex flex-col gap-1">
      <Textarea
        aria-label="Note"
        rows={4}
        value={text}
        placeholder="What was seen, where, what to do"
        onChange={(e) => setText(e.target.value)}
        className="resize-none"
      />
      <span
        aria-live="polite"
        className={state === "error" ? "h-4 text-2xs text-danger" : "h-4 text-2xs text-muted"}
      >
        {LABEL[state]}
      </span>
    </div>
  );
}
