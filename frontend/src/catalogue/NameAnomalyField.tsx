import { useState, type KeyboardEvent } from "react";
import { messageOf } from "@/api/errors";
import { Button, Input } from "@/ui";

/**
 * Names an anomaly that does not exist yet. A div, not a form, so it can sit inside the pin
 * callout's form without nesting. Enter stays on this field.
 */
export function NameAnomalyField({
  onCreate,
  placeholder = "Name a new anomaly",
  submitLabel = "Add",
}: {
  onCreate: (name: string) => Promise<void> | void;
  placeholder?: string;
  submitLabel?: string;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setName("");
    } catch (e) {
      setError(messageOf(e, "could not add the anomaly"));
    } finally {
      setBusy(false);
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    void submit();
  };

  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="New anomaly">
      <div className="flex items-center gap-1.5">
        <Input
          dense
          aria-label="New anomaly name"
          placeholder={placeholder}
          value={name}
          disabled={busy}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={busy}
          disabled={!name.trim()}
          onClick={() => void submit()}
        >
          {submitLabel}
        </Button>
      </div>
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
