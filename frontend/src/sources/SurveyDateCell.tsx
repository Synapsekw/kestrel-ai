import { useState, type FormEvent, type KeyboardEvent } from "react";
import { messageOf } from "@/api/errors";
import { Button, Input, cx, focusRing, transition } from "@/ui";

/**
 * A survey date that is edited where it is shown. A missing date reads "date not set" and is never
 * guessed; saving an empty field clears the date. Escape cancels.
 */
export function SurveyDateCell({
  label,
  value,
  onSave,
}: {
  /** The source's name, for the accessible names of the controls. */
  label: string;
  value: string | null;
  onSave: (next: string | null) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function start() {
    setDraft(value ?? "");
    setError(null);
    setEditing(true);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    const next = draft.trim() || null;
    if (next === value) return setEditing(false);
    setBusy(true);
    setError(null);
    try {
      await onSave(next);
      setEditing(false);
    } catch (err) {
      setError(messageOf(err, "could not save the date"));
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      setEditing(false);
      setError(null);
    }
  }

  if (!editing)
    return (
      <button
        type="button"
        onClick={start}
        aria-label={`${value ? "Change" : "Set"} the survey date of ${label}`}
        className={cx(
          "-mx-1.5 rounded-md px-1.5 py-0.5 text-left tabular-nums hover:bg-hover",
          value ? "text-ink" : "text-muted",
          transition,
          focusRing,
        )}
      >
        {value ?? "date not set"}
      </button>
    );

  return (
    <form onSubmit={(e) => void save(e)} onKeyDown={onKeyDown} className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <Input
          type="date"
          dense
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label={`Survey date of ${label}`}
          invalid={!!error}
          className="w-[9.5rem]"
        />
        <Button type="submit" size="sm" variant="primary" loading={busy}>
          Save
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
