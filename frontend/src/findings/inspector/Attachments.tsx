import { useEffect, useState } from "react";
import { useApi, useBackend } from "@/api/client";
import { codeOf, messageOf } from "@/api/errors";
import {
  addAttachment,
  attachmentFileUrl,
  attachmentThumbnailUrl,
  deleteAttachment,
  listAttachments,
  type FindingAttachment,
} from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, Dialog, Icon, Input, cx, focusRing, lift, pressable, transition } from "@/ui";

function refusal(e: unknown): string {
  return codeOf(e) === "attachment_invalid"
    ? `This photo was not added: ${messageOf(e, "not a JPEG, PNG or WebP under 50 MB")}`
    : messageOf(e, "could not add the photo");
}

const tile = cx(
  "block aspect-[4/3] w-full overflow-hidden rounded-sm",
  transition,
  lift,
  pressable,
  focusRing,
);

/**
 * F §8.7 item 8: a grid of the 256 px thumbnails, add through the Tauri file dialog (a path field
 * in the browser), and a lightbox that is the only place the original is loaded.
 */
export function Attachments({ projectId, findingId }: { projectId: string; findingId: string }) {
  const api = useApi();
  const { baseUrl, token, mode } = useBackend();
  const [loaded, setLoaded] = useState<{ id: string; items: FindingAttachment[] } | null>(null);
  const [revision, setRevision] = useState(0);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<FindingAttachment | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAttachments(api, projectId, findingId)
      .then((items) => {
        if (!cancelled) setLoaded({ id: findingId, items });
      })
      .catch((e: unknown) => pushLog(`attachments unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId, revision]);

  async function add(file: string) {
    setBusy(true);
    setError(null);
    try {
      await addAttachment(api, projectId, findingId, file);
      setPath("");
      setRevision((r) => r + 1);
      useChangesStore.getState().bumpFindings();
    } catch (e) {
      setError(refusal(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick() {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({
      multiple: false,
      filters: [{ name: "Photos", extensions: ["jpg", "jpeg", "png", "webp"] }],
    });
    if (typeof picked === "string") await add(picked);
  }

  async function remove(a: FindingAttachment) {
    try {
      await deleteAttachment(api, projectId, findingId, a.id);
      setViewing(null);
      setRevision((r) => r + 1);
      useChangesStore.getState().bumpFindings();
    } catch (e) {
      setError(messageOf(e, "could not remove the photo"));
    }
  }

  const items = loaded?.id === findingId ? loaded.items : [];
  const desktop = mode === "tauri";
  return (
    <div className="flex flex-col gap-2">
      {(items.length > 0 || desktop) && (
        <ul className="grid grid-cols-4 gap-1.5">
          {items.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                aria-label={`View ${a.original_name}`}
                onClick={() => setViewing(a)}
                className={cx(tile, "bg-surface-2")}
              >
                <img
                  src={attachmentThumbnailUrl(baseUrl, token, projectId, findingId, a.id)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            </li>
          ))}
          {desktop && (
            <li>
              <button
                type="button"
                aria-label="Add photo"
                title="Add photo"
                disabled={busy}
                onClick={() => void pick()}
                className={cx(
                  tile,
                  "grid place-items-center border border-dashed border-line-strong text-muted hover:border-accent/60 hover:text-ink",
                  "disabled:pointer-events-none disabled:opacity-45",
                )}
              >
                <Icon
                  name={busy ? "spinner" : "plus"}
                  size={16}
                  className={busy ? "animate-spin reduce-motion:animate-none" : undefined}
                />
              </button>
            </li>
          )}
        </ul>
      )}
      {!desktop && (
        <div className="flex gap-2">
          <Input
            aria-label="Photo file"
            dense
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="E:/photos/site.jpg"
            className="font-mono"
          />
          <Button size="sm" loading={busy} disabled={!path.trim()} onClick={() => void add(path.trim())}>
            Add photo
          </Button>
        </div>
      )}
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
      <Dialog
        open={viewing !== null}
        title={viewing?.original_name ?? ""}
        width="lg"
        onClose={() => setViewing(null)}
        footer={
          viewing && (
            <Button variant="danger" icon="trash" onClick={() => void remove(viewing)}>
              Remove photo
            </Button>
          )
        }
      >
        {viewing && (
          <img
            src={attachmentFileUrl(baseUrl, token, projectId, findingId, viewing.id)}
            alt={viewing.original_name}
            className="max-h-[70vh] w-full rounded-control object-contain"
          />
        )}
      </Dialog>
    </div>
  );
}
