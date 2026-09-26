import { useCallback } from "react";
import { useBackend } from "@/api/client";
import { Button, Field, Input } from "@/ui";

/** Folder input: a native directory picker inside Tauri, a plain text field in the browser. */
export function FolderField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (folder: string) => void;
  hint?: string;
}) {
  const { mode } = useBackend();
  const pick = useCallback(async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ directory: true });
    if (typeof picked === "string") onChange(picked);
  }, [onChange]);

  return (
    <Field label={label} htmlFor={id} hint={hint}>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="E:\Projects\Ahmadia"
          className="font-mono"
        />
        {mode === "tauri" && (
          <Button icon="folder" onClick={() => void pick()}>
            Browse
          </Button>
        )}
      </div>
    </Field>
  );
}
