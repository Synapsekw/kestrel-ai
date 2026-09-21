import { useState } from "react";
import { useBackend } from "@/api/client";
import { Alert, Button, Field, Input } from "@/ui";
export function FolderField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (folder: string) => void;
  disabled?: boolean;
}) {
  const { mode } = useBackend();
  const [error, setError] = useState(false);
  const id = `agent-${label.replaceAll(" ", "-").toLowerCase()}`;
  async function pick() {
    try {
      setError(false);
      const { open } = await import("@tauri-apps/plugin-dialog");
      const folder = await open({ directory: true });
      if (typeof folder === "string") onChange(folder);
    } catch {
      setError(true);
    }
  }
  return (
    <Field label={label} htmlFor={id}>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 font-mono"
          placeholder="Choose a folder on this computer"
        />
        {mode === "tauri" && (
          <Button
            icon="folder"
            disabled={disabled}
            onClick={() => void pick()}
            aria-label={`Choose ${label.toLowerCase()}`}
          >
            Browse
          </Button>
        )}
      </div>
      {error && (
        <Alert tone="danger">The folder picker could not open. Type the folder path or try again.</Alert>
      )}
    </Field>
  );
}
