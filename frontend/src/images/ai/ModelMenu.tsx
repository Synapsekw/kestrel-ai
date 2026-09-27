import { useEffect, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import { useProjectTypes } from "@/findings/useProjectTypes";
import { Button, Kbd, Popover, Slider, cx, focusRing } from "@/ui";
import { useAiStore } from "./aiStore";
import { useWs } from "./bridge";
import { DEFAULT_CONF, menuSubtitle, readConf, readLastModel, stem } from "./models";
import { stopTabPropagation } from "./overlayKeys";
import { useDetect } from "./useDetect";
import { useDetectModels } from "./useDetectModels";

/** Spec §11.2: "Run a library model on this image", 244 px, D or Enter runs. */
export function ModelMenu({
  projectId,
  anchorRef,
}: {
  projectId: string;
  anchorRef: RefObject<HTMLElement>;
}) {
  const open = useAiStore((s) => s.menuOpen);
  const runNonce = useAiStore((s) => s.runNonce);
  const image = useWs((s) => s.image);
  const { all } = useProjectTypes(projectId);
  const { models, loading, error } = useDetectModels(projectId);
  const run = useDetect(projectId);
  const detecting = useAiStore((s) => s.detect !== null);
  const [modelId, setModelId] = useState<string | null>(() => readLastModel(projectId));
  // Re-seed on a project change (M7): the menu can outlive one project.
  const [modelFor, setModelFor] = useState(projectId);
  if (modelFor !== projectId) {
    setModelFor(projectId);
    setModelId(readLastModel(projectId));
  }
  const chosen = models.find((m) => m.id === modelId) ?? models[0] ?? null;
  const [conf, setConf] = useState(DEFAULT_CONF);
  const primary = useRef<HTMLButtonElement>(null);
  // Adjust state during render (React's documented alternative to an effect that only mirrors a
  // derived value) rather than `useEffect` + `setConf`, which the repo's `set-state-in-effect`
  // lint rule refuses: the model list resolves asynchronously, so `chosen` starts null and only
  // gains an id once library models load.
  const [confForModel, setConfForModel] = useState<string | null>(null);
  if (chosen && confForModel !== chosen.id) {
    setConfForModel(chosen.id);
    setConf(readConf(chosen.id));
  }

  const go = () => {
    if (chosen && image) void run(image.id, chosen, conf);
  };
  const lastNonce = useRef(runNonce);
  useEffect(() => {
    if (runNonce !== lastNonce.current) {
      lastNonce.current = runNonce;
      if (open) go();
    }
  });

  return (
    // Tab from FA's registered key rows preventDefaults at window level (Task 5 review); stop it
    // here, after Popover's own Escape/focus-trap handling has run, so focus still moves inside.
    <div className="contents" onKeyDown={stopTabPropagation}>
      <Popover
        open={open}
        onClose={() => useAiStore.getState().closeMenu()}
        anchorRef={anchorRef}
        label="Run a library model on this image"
        side="right"
        align="start"
        initialFocusRef={primary}
        className="w-[244px] p-3"
      >
        <h2 className="mb-2 text-sm font-semibold">Run a library model on this image</h2>
        {loading ? <p className="text-sm text-muted">Loading models…</p> : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {!loading && !error && models.length === 0 ? (
          <p className="text-sm text-muted">
            No library model reaches this project's types.{" "}
            <Link className={cx("text-accent-ink underline", focusRing)} to="/models/library">
              Map classes in Models
            </Link>
          </p>
        ) : null}
        <ul role="listbox" aria-label="Library models" className="mb-3 flex flex-col gap-1">
          {models.map((m) => (
            <li key={m.id} role="option" aria-selected={m.id === chosen?.id}>
              <button
                type="button"
                onClick={() => setModelId(m.id)}
                className={cx(
                  "w-full rounded-control px-2 py-1.5 text-left hover:bg-hover",
                  m.id === chosen?.id && "bg-accent-soft",
                  focusRing,
                )}
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm">{m.name}</span>
                  {m.metrics ? (
                    <span className="font-mono text-xs text-muted">{m.metrics.map50.toFixed(2)}</span>
                  ) : null}
                </span>
                <span className="block truncate text-xs text-muted">{menuSubtitle(m, all)}</span>
              </button>
            </li>
          ))}
        </ul>
        {chosen ? (
          <>
            <Slider
              label="Confidence"
              min={0.05}
              max={0.95}
              step={0.05}
              value={conf}
              onChange={setConf}
              format={(v) => `${Math.round(v * 100)}%`}
              showValue
              className="mb-3"
            />
            <Button
              ref={primary}
              variant="primary"
              className="w-full justify-between"
              onClick={go}
              disabled={!image || detecting}
            >
              <span className="truncate">Detect on {image ? stem(image.file_name) : "this image"}</span>
              <Kbd>D</Kbd>
            </Button>
          </>
        ) : null}
      </Popover>
    </div>
  );
}
