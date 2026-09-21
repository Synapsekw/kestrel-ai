import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { isActiveJob } from "@/store/jobs";
import { Alert, Button, Disclosure, Field, IconButton, Select, Textarea } from "@/ui";
import { EstimateCard } from "@/query/EstimateCard";
import { FolderField } from "./FolderField";
import { PlanEditor } from "./PlanEditor";
import { FirstBatchPicker } from "./FirstBatchPicker";
import { SetupJob } from "./SetupJob";
import { useSetupAgent } from "./useSetupAgent";

/** Remains mounted in Shell: closing or navigating never discards a project or pending job. */
export function SetupAgent({ open, onClose }: { open: boolean; onClose: () => void }) {
  const a = useSetupAgent(open);
  const panel = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    opener.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    return () => {
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [open]);
  if (!open) return null;
  const busy = !!a.busy;
  const conversation = (
    <div className="flex flex-col gap-4">
      <div
        role="log"
        aria-label="Setup conversation"
        aria-live="polite"
        className="flex max-h-64 flex-col gap-3 overflow-y-auto"
      >
        {a.messages.length === 0 && (
          <p className="text-sm leading-relaxed text-muted">
            Describe what you want to detect and your drone imagery. We’ll turn it into a project plan you can
            edit.
          </p>
        )}
        {a.messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "rounded-md bg-well px-3 py-2" : "py-1"}>
            <p className="mb-1 text-xs font-medium text-muted">{m.role === "user" ? "You" : "Setup agent"}</p>
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.content}</p>
          </div>
        ))}
      </div>
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void a.send();
        }}
      >
        <Field label="Message" htmlFor="agent-message">
          <Textarea
            id="agent-message"
            rows={3}
            maxLength={2000}
            value={a.message}
            disabled={busy}
            onChange={(e) => a.setMessage(e.target.value)}
            placeholder="Find excavators and trucks in overhead site photos…"
          />
        </Field>
        <Button
          type="submit"
          variant={a.plan ? "secondary" : "primary"}
          disabled={!a.ready || !a.message.trim() || busy}
          loading={a.busy === "chat"}
          className="self-end"
        >
          Send
        </Button>
      </form>
      <p className="text-xs text-muted">
        Messages and the plan go to your selected provider. Don’t include passwords or API keys. Folders and
        images are not sent in chat.
      </p>
    </div>
  );
  return (
    <aside
      ref={panel}
      id="setup-agent"
      role="dialog"
      aria-label="Setup agent"
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
          <h2 className="text-base font-semibold">Setup agent</h2>
          <p className="mt-0.5 text-xs text-muted">
            {a.project ? a.project.name : "From an idea to your first reviewed labels"}
          </p>
        </div>
        <IconButton icon="x" label="Close setup agent" onClick={onClose} />
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
        <div className="flex flex-col gap-2">
          <Field label="Planning provider" htmlFor="agent-provider">
            <Select
              id="agent-provider"
              value={a.provider}
              disabled={busy}
              onChange={(e) => a.setProvider(e.target.value as "openai" | "anthropic")}
            >
              <option value="openai">GPT · OpenAI</option>
              <option value="anthropic">Claude · Anthropic</option>
            </Select>
          </Field>
          <p role="status" className="text-xs text-muted">
            {a.metadataLoading
              ? "Checking provider settings…"
              : a.currentProvider
                ? `${a.currentProvider.model_name} · ${a.ready ? "Ready" : "Key required"}`
                : "Provider is not configured"}
          </p>
          <Link
            to="/settings"
            onClick={onClose}
            className="self-start text-sm text-accent-ink underline underline-offset-2"
          >
            App settings
          </Link>
          {a.metadataError && (
            <Alert
              tone="danger"
              actions={
                <Button size="sm" onClick={a.refreshMetadata}>
                  Retry settings
                </Button>
              }
            >
              {a.metadataError}
            </Alert>
          )}
        </div>
        {a.error && <Alert tone="danger">{a.error}</Alert>}
        {a.pollError && <Alert tone="warn">{a.pollError}</Alert>}
        {a.project ? (
          <Disclosure label="Continue the conversation">
            <p className="mb-3 text-xs text-muted">
              Your created project stays as reviewed. Change its name and classes in Project settings.
            </p>
            {conversation}
          </Disclosure>
        ) : (
          conversation
        )}
        {!a.project && a.plan && (
          <PlanEditor
            plan={a.plan}
            onChange={a.setPlan}
            catalog={a.catalog}
            folder={a.folder}
            onFolderChange={a.setFolder}
            valid={a.validPlan}
            busy={busy}
            onCreate={() => void a.create()}
          />
        )}
        {a.project && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
              <p className="text-sm text-ok">Project created</p>
              <Link
                to={`/p/${a.project.id}`}
                onClick={onClose}
                className="text-sm text-accent-ink underline underline-offset-2"
              >
                Open project
              </Link>
            </div>
            {a.jobs.starter ? (
              <SetupJob
                title="Starter download"
                job={a.jobs.starter}
                busy={busy}
                onCancel={() => void a.cancel("starter")}
                onRetry={() => void a.acquire()}
                retryLabel="Retry starter download"
              />
            ) : (
              <Button disabled={busy} onClick={() => void a.acquire()}>
                Retry starter download
              </Button>
            )}
            {!a.runId && (
              <>
                {(!a.page || a.page.items.length === 0) && (
                  <section className="flex flex-col gap-3 border-t border-line pt-5">
                    <h3 className="text-base font-semibold">Bring in your images</h3>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
                      {a.plan?.image_guidance}
                    </p>
                    <p className="text-sm text-muted">
                      Include varied angles, object sizes, lighting and empty scenes. Avoid adjacent
                      near-duplicate frames.
                    </p>
                    <FolderField
                      label="Image folder"
                      value={a.sourceFolder}
                      onChange={a.setSourceFolder}
                      disabled={busy || (!!a.jobs.import && isActiveJob(a.jobs.import))}
                    />
                    <Button
                      variant="primary"
                      disabled={
                        !a.sourceFolder.trim() || busy || (!!a.jobs.import && isActiveJob(a.jobs.import))
                      }
                      onClick={() => void a.importImages()}
                    >
                      Import images
                    </Button>
                  </section>
                )}
                {a.jobs.import && (
                  <SetupJob
                    title="Image import"
                    job={a.jobs.import}
                    busy={busy}
                    onCancel={() => void a.cancel("import")}
                    onRetry={() => void a.importImages()}
                    retryLabel="Retry image import"
                  />
                )}
                {a.jobs.import && !isActiveJob(a.jobs.import) && !a.page && (
                  <Button disabled={busy} onClick={() => void a.refreshImages()}>
                    Refresh images
                  </Button>
                )}
                {a.page && (
                  <FirstBatchPicker
                    projectId={a.project.id}
                    page={a.page}
                    selected={a.selected}
                    toggle={a.toggle}
                    onPage={(cursor) => void a.refreshImages(cursor)}
                    busy={busy}
                  />
                )}
                {a.page && a.page.items.length > 0 && (
                  <section className="flex flex-col gap-3 border-t border-line pt-5">
                    <Field label="Labeling instructions" htmlFor="agent-query">
                      <Textarea
                        id="agent-query"
                        rows={3}
                        value={a.query}
                        maxLength={2000}
                        disabled={busy}
                        onChange={(e) => a.setQuery(e.target.value)}
                      />
                    </Field>
                    <p className="text-sm text-muted">
                      Selected images will be sent to {a.provider === "openai" ? "OpenAI" : "Anthropic"}. API
                      charges are approximate. Suggestions remain unreviewed until you accept them.
                    </p>
                    <Button disabled={!a.batchReady || busy} onClick={() => void a.calculate()}>
                      Estimate first labeling
                    </Button>
                    {a.estimate && <EstimateCard estimate={a.estimate} local={false} />}
                    <Button
                      variant="primary"
                      disabled={!a.estimate || !a.batchReady || busy}
                      onClick={() => void a.start()}
                    >
                      Start first labeling
                    </Button>
                  </section>
                )}
              </>
            )}
            {a.jobs.label && (
              <>
                <SetupJob
                  title="First labeling"
                  job={a.jobs.label}
                  busy={busy}
                  onCancel={() => void a.cancel("label")}
                  onRetry={() => void a.resume()}
                  retryLabel="Resume first labeling"
                />
                {!isActiveJob(a.jobs.label) && (
                  <>
                    <p className="text-sm text-muted">
                      Review each suggestion before accepting it as a label. Then build a dataset and train
                      from the ordinary project workflow.
                    </p>
                    <Link
                      to={`/p/${a.project.id}/review`}
                      onClick={onClose}
                      className="text-sm font-medium text-accent-ink underline underline-offset-2"
                    >
                      Review suggestions
                    </Link>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
      {a.project && (
        <Button variant="ghost" disabled={!a.canReset} onClick={a.reset}>
          Start another project
        </Button>
      )}
      <p className="shrink-0 border-t border-line px-5 py-3 text-xs text-muted">
        You can close this drawer. Your draft stays for this session and background jobs continue.
      </p>
    </aside>
  );
}
