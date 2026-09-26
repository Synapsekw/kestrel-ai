import { useCallback, useState } from "react";
import { useApi } from "@/api/client";
import { patchFinding } from "@/api/findings";
import { useChangesStore } from "@/store/changes";
import { Textarea } from "@/ui";
import { useAutosave } from "./useAutosave";

const LABEL = {
  idle: "",
  saving: "Saving…",
  saved: "Saved",
  error: "Not saved. Keep typing to retry.",
} as const;

/**
 * F §8.7 item 7. Mounted with `key={findingId}`: it reads `initial` once, so a refetch never
 * overwrites what the operator is typing, and its save is bound to its own finding.
 */
export function NoteField({
  projectId,
  findingId,
  initial,
}: {
  projectId: string;
  findingId: string;
  initial: string;
}) {
  const api = useApi();
  const [text, setText] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const save = useCallback(
    async (v: string) => {
      await patchFinding(api, projectId, findingId, { note: v });
      setSaved(v);
      useChangesStore.getState().bumpFindings();
    },
    [api, projectId, findingId],
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
