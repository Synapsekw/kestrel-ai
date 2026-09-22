import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import type { ProviderName } from "@contract/client";
import { providerLabel } from "@/api/providers";
import {
  Alert,
  Button,
  Field,
  IconButton,
  Select,
  Skeleton,
  Textarea,
  cx,
  focusRing,
  transition,
} from "@/ui";
import { Transcript } from "./Transcript";
import { MESSAGE_MAX, useProjectAgent } from "./useProjectAgent";

const EXAMPLES = [
  "Label the first 500 images with excavator and dump truck",
  "How many images still have unreviewed suggestions?",
  "Build a dataset from the labeled images and train yolo11n for 30 epochs",
];

const FALLBACK_PROVIDERS: ProviderName[] = ["openai", "anthropic"];

/** Remains mounted in Shell per project: closing the drawer keeps the draft; turns run on the backend. */
export function ProjectAgent({
  projectId,
  projectName,
  open,
  onClose,
}: {
  projectId: string;
  projectName: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const a = useProjectAgent(projectId, open);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [open]);
  const lastSeq = a.items.at(-1)?.seq ?? 0;
  const turnState = a.turn?.state;
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastSeq, turnState, open]);
  if (!open) return null;

  const current = a.providers.find((p) => p.name === a.provider);
  const keyMissing = a.providersReady && !a.providersError && !a.hasKey(a.provider);
  const locked = a.busy || a.awaiting;
  const canSend = !!a.message.trim() && !locked && !a.pending && a.hasKey(a.provider);
  const options = a.providers.length > 0 ? a.providers.map((p) => p.name) : FALLBACK_PROVIDERS;

  return (
    <aside
      ref={panel}
      id="project-agent"
      role="dialog"
      aria-label="Project agent"
      aria-modal="false"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onClose();
        }
      }}
      className="absolute inset-y-0 right-0 z-30 flex w-[34rem] max-w-full flex-col border-l border-line bg-panel text-ink shadow-float animate-slide-in focus:outline-none motion-reduce:animate-none"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-line px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Project agent</h2>
          <p className="mt-0.5 truncate text-xs text-muted">{projectName ?? "This project"}</p>
        </div>
        <IconButton
          icon="trash"
          label="Clear conversation"
          disabled={locked || a.pending || a.items.length === 0}
          onClick={() => void a.clear()}
        />
        <IconButton icon="x" label="Close project agent" onClick={onClose} />
      </header>

      <div className="flex shrink-0 flex-wrap items-end gap-x-3 gap-y-1 border-b border-line px-5 py-3">
        <Field label="Provider" htmlFor="project-agent-provider" className="w-56">
          <Select
            id="project-agent-provider"
            value={a.provider}
            disabled={locked || a.pending}
            onChange={(e) => a.setProvider(e.target.value as ProviderName)}
          >
            {options.map((name) => (
              <option key={name} value={name}>
                {name === "openai" ? "GPT · OpenAI" : "Claude · Anthropic"}
              </option>
            ))}
          </Select>
        </Field>
        <p role="status" className="pb-2 text-xs text-muted">
          {!a.providersReady
            ? "Checking provider settings…"
            : current
              ? `${current.model_name} · ${current.has_key ? "Ready" : "Key required"}`
              : "Provider is not configured"}
        </p>
      </div>

      <div ref={scroller} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
        {!a.loaded && !a.error ? (
          <Skeleton className="h-16 w-full" />
        ) : a.items.length === 0 ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm leading-relaxed text-muted">
              Ask for work on this project in plain words. The agent uses the same actions as the app and asks
              before anything costly or destructive.
            </p>
            <p className="text-xs font-medium text-muted">Try</p>
            <ul className="flex flex-col gap-2">
              {EXAMPLES.map((text) => (
                <li key={text}>
                  <button
                    type="button"
                    onClick={() => a.setMessage(text)}
                    className={cx(
                      "w-full rounded-md border border-line px-3 py-2 text-left text-[13px] leading-relaxed text-ink hover:border-line-strong hover:bg-hover",
                      transition,
                      focusRing,
                    )}
                  >
                    {text}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <Transcript
            items={a.items}
            awaiting={a.awaiting}
            deciding={a.pending}
            onDecide={(approve) => void a.decide(approve)}
          />
        )}
        {a.busy && (
          <p role="status" className="text-xs text-muted">
            Working… You can close this drawer; the agent keeps going.
          </p>
        )}
        {a.turn?.state === "failed" && a.turn.error && (
          <Alert tone="danger" title="The agent stopped">
            {a.turn.error}
          </Alert>
        )}
        {a.turn?.state === "cancelled" && <p className="text-xs text-muted">Stopped.</p>}
        {a.error && <Alert tone="danger">{a.error}</Alert>}
      </div>

      <div className="flex shrink-0 flex-col gap-2 border-t border-line px-5 py-3">
        {a.providersError && <Alert tone="danger">{a.providersError}</Alert>}
        {keyMissing && (
          <Alert tone="warn">
            {providerLabel(a.provider)} has no API key. Add one in{" "}
            <Link to="/settings" onClick={onClose} className="text-accent-ink underline underline-offset-2">
              App settings
            </Link>
            .
          </Alert>
        )}
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void a.send();
          }}
        >
          <Field label="Message" htmlFor="project-agent-message">
            <Textarea
              id="project-agent-message"
              rows={3}
              maxLength={MESSAGE_MAX}
              value={a.message}
              onChange={(e) => a.setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void a.send();
                }
              }}
              placeholder="Label the first 500 images with excavator and dump truck…"
            />
          </Field>
          <div className="flex items-center justify-end gap-2">
            <p className="mr-auto text-xs text-dim">Enter to send, Shift+Enter for a new line</p>
            {a.busy && (
              <Button variant="secondary" disabled={a.pending} onClick={() => void a.stop()}>
                Stop
              </Button>
            )}
            <Button type="submit" variant="primary" disabled={!canSend}>
              Send
            </Button>
          </div>
        </form>
      </div>
      <p className="shrink-0 border-t border-line px-5 py-3 text-xs text-muted">
        Messages, tool results and any image the agent views go to your selected provider.
      </p>
    </aside>
  );
}
