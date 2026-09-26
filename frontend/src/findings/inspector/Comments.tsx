import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useApi } from "@/api/client";
import { messageOf } from "@/api/errors";
import { addComment, deleteComment, editComment, listComments, type FindingComment } from "@/api/findings";
import { pushLog } from "@/app/diagnostics";
import { useNow } from "@/jobs/useNow";
import { useChangesStore } from "@/store/changes";
import { Alert, Button, IconButton, Textarea } from "@/ui";
import { relativeTime } from "../format";

const MAX_TEXT = 4000;

/** Enter sends, Shift+Enter is a new line; Esc cancels an edit. */
function onEnter(e: KeyboardEvent<HTMLTextAreaElement>, send: () => void, cancel?: () => void) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    send();
  } else if (e.key === "Escape" && cancel) {
    e.preventDefault();
    cancel();
  }
}

/** Up to two initials of the author name the server wrote on the comment. */
function initials(author: string): string {
  return author
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

/**
 * F §8.7 item 9. The author is the server's (the operator name from Settings); one operator uses
 * the app, so every comment is theirs to edit or delete. Paged by `COMMENTS_PAGE`.
 */
export function Comments({ projectId, findingId }: { projectId: string; findingId: string }) {
  const api = useApi();
  const nowMs = useNow(60_000);
  const [loaded, setLoaded] = useState<{ id: string; items: FindingComment[]; cursor: string | null } | null>(
    null,
  );
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A second Enter before the first post returns must not post the reply twice.
  const sending = useRef(false);

  useEffect(() => {
    let cancelled = false;
    listComments(api, projectId, findingId)
      .then((page) => {
        if (!cancelled) setLoaded({ id: findingId, items: page.items, cursor: page.next_cursor });
      })
      .catch((e: unknown) => pushLog(`comments unavailable: ${messageOf(e, String(e))}`));
    return () => {
      cancelled = true;
    };
  }, [api, projectId, findingId]);

  const current = loaded?.id === findingId ? loaded : null;
  const items = current?.items ?? [];
  const setItems = (next: (xs: FindingComment[]) => FindingComment[]) =>
    setLoaded((s) => (s && s.id === findingId ? { ...s, items: next(s.items) } : s));

  async function more() {
    if (!current?.cursor) return;
    try {
      const page = await listComments(api, projectId, findingId, current.cursor);
      setLoaded((s) =>
        s && s.id === findingId
          ? {
              ...s,
              items: [...s.items, ...page.items],
              cursor: page.next_cursor === s.cursor ? null : page.next_cursor,
            }
          : s,
      );
    } catch (e) {
      setError(messageOf(e, "could not load more comments"));
    }
  }

  async function send() {
    const text = reply.trim();
    if (!text || sending.current) return;
    sending.current = true;
    try {
      const c = await addComment(api, projectId, findingId, text);
      setItems((xs) => [...xs, c]);
      setReply("");
      useChangesStore.getState().bumpFindings();
    } catch (e) {
      setError(messageOf(e, "could not post the comment"));
    } finally {
      sending.current = false;
    }
  }

  async function saveEdit() {
    if (!editing || !editing.text.trim()) return;
    try {
      const c = await editComment(api, projectId, findingId, editing.id, editing.text.trim());
      setItems((xs) => xs.map((x) => (x.id === c.id ? c : x)));
      setEditing(null);
    } catch (e) {
      setError(messageOf(e, "could not save the comment"));
    }
  }

  async function remove(id: string) {
    try {
      await deleteComment(api, projectId, findingId, id);
      setItems((xs) => xs.filter((x) => x.id !== id));
      setDeleting(null);
      useChangesStore.getState().bumpFindings();
    } catch (e) {
      setError(messageOf(e, "could not delete the comment"));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length > 0 && (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.id} className="grid grid-cols-[24px_1fr] gap-2 text-sm">
              <span
                aria-hidden
                className="grid h-6 w-6 place-items-center rounded-full bg-accent-soft text-2xs font-semibold text-accent-ink"
              >
                {initials(c.author)}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-xs font-semibold text-ink">
                    {c.author}{" "}
                    <span className="font-normal text-dim">{relativeTime(c.created_at, nowMs)}</span>
                    {c.edited_at && <span className="ml-1 font-normal text-dim">(edited)</span>}
                  </span>
                  <span className="flex shrink-0 gap-0.5">
                    <IconButton
                      size="sm"
                      icon="label"
                      label="Edit comment"
                      onClick={() => setEditing({ id: c.id, text: c.text })}
                    />
                    <IconButton
                      size="sm"
                      icon="trash"
                      label="Delete comment"
                      onClick={() => setDeleting(c.id)}
                    />
                  </span>
                </div>
                {editing?.id === c.id ? (
                  <Textarea
                    aria-label="Edit comment"
                    rows={2}
                    maxLength={MAX_TEXT}
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing({ id: c.id, text: e.target.value })}
                    onKeyDown={(e) =>
                      onEnter(
                        e,
                        () => void saveEdit(),
                        () => setEditing(null),
                      )
                    }
                    className="resize-none"
                  />
                ) : (
                  <p className="whitespace-pre-wrap break-words text-ink">{c.text}</p>
                )}
                {deleting === c.id && (
                  <Alert
                    tone="warn"
                    role="status"
                    actions={
                      <>
                        <Button size="sm" variant="danger" onClick={() => void remove(c.id)}>
                          Delete
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleting(null)}>
                          Keep
                        </Button>
                      </>
                    }
                  >
                    Delete this comment?
                  </Alert>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {current?.cursor && (
        <Button size="sm" variant="ghost" onClick={() => void more()} className="self-start">
          Show more comments
        </Button>
      )}
      <Textarea
        aria-label="Reply"
        rows={2}
        maxLength={MAX_TEXT}
        placeholder="Reply · Enter to send"
        value={reply}
        onChange={(e) => setReply(e.target.value)}
        onKeyDown={(e) => onEnter(e, () => void send())}
        className="resize-none"
      />
      {error && (
        <Alert tone="danger" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}
    </div>
  );
}
