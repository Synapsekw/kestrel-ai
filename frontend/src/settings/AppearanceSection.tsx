import { useEffect, useRef, useState } from "react";
import { useApi } from "@/api/client";
import { readEffectsChoice, setEffectsChoice, type EffectsChoice } from "@/app/effects";
import { Field, Input, Segmented, Switch } from "@/ui";
import { readMotionChoice, setMotionChoice } from "@/ui/motion";
import { DEFAULT_OPERATOR_NAME, fetchOperatorName, saveOperatorName } from "./operatorName";

const EFFECTS: { value: EffectsChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "full", label: "Full" },
  { value: "reduced", label: "Reduced" },
];

/** Settings → Appearance (F §4.3): visual effects, reduce motion, and the name on comments (§5.3). */
export function AppearanceSection() {
  const [effects, setEffects] = useState<EffectsChoice>(() => readEffectsChoice());
  const [motion, setMotion] = useState(() => readMotionChoice() === "reduce");
  const api = useApi();
  const [name, setName] = useState("");
  const [saved, setSaved] = useState<"idle" | "saved" | "failed">("idle");
  // The name loads asynchronously; if the operator starts typing before it lands, the fetch must
  // not clobber what they typed.
  const dirty = useRef(false);

  useEffect(() => {
    let live = true;
    fetchOperatorName(api)
      .then((stored) => {
        if (live && !dirty.current) setName(stored ?? "");
      })
      .catch(() => {
        // The field stays empty (comments say "Operator"); saving still works once the backend answers.
      });
    return () => {
      live = false;
    };
  }, [api]);

  return (
    <section className="flex flex-col gap-5 py-6" aria-labelledby="appearance-title">
      <div className="flex flex-col gap-1">
        <h2 id="appearance-title" className="text-lg font-semibold">
          Appearance
        </h2>
        <p className="text-sm text-muted">How the app looks and moves on this computer.</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Segmented
          label="Visual effects"
          options={EFFECTS}
          value={effects}
          onChange={(choice) => {
            setEffectsChoice(choice);
            setEffects(choice);
          }}
        />
        <p className="max-w-prose text-xs text-muted">
          Auto starts with full effects and reduces them if this computer draws slowly. Reduced drops the
          frosted glass and glows. Your choice here is final.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Switch
          label="Reduce motion"
          checked={motion}
          onChange={(on) => {
            setMotionChoice(on ? "reduce" : "system");
            setMotion(on);
          }}
        />
        <p className="max-w-prose text-xs text-muted">
          Animations become instant. The Windows setting to reduce animations always applies as well.
        </p>
      </div>
      <Field
        label="Your name"
        htmlFor="operator-name"
        hint={
          saved === "saved"
            ? "Saved"
            : saved === "failed"
              ? "Could not save your name"
              : "Shown on your comments."
        }
        className="max-w-sm"
      >
        <Input
          id="operator-name"
          value={name}
          placeholder={DEFAULT_OPERATOR_NAME}
          onChange={(e) => {
            dirty.current = true;
            setSaved("idle");
            setName(e.target.value);
          }}
          onBlur={() => {
            saveOperatorName(api, name)
              .then((stored) => {
                setName(stored ?? "");
                setSaved("saved");
              })
              .catch(() => setSaved("failed"));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
      </Field>
    </section>
  );
}
