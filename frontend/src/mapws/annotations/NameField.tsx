import { useState } from "react";
import { Input } from "@/ui";

/**
 * Saves on blur or Enter; a blank name reverts and is never sent (Review Focus 5). Key it by
 * `id:name` so an outside rename resets it.
 */
export function NameField({ initial, onSave }: { initial: string; onSave: (name: string) => void }) {
  const [value, setValue] = useState(initial);
  const commit = () => {
    const v = value.trim();
    if (!v) {
      setValue(initial);
      return;
    }
    if (v !== initial) onSave(v);
  };
  return (
    <Input
      aria-label="Name"
      value={value}
      maxLength={200}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}
