import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Button, Field, Icon, Select } from "@/ui";
import { ClassSidebar } from "./ClassSidebar";
import { RegionList } from "./RegionList";

interface Props extends ComponentProps<typeof ClassSidebar> {
  regions: ComponentProps<typeof RegionList>;
  reviewControls: ReactNode;
}

/** One contextual panel keeps drawing, review and region editing beside the image. */
export function EditorInspector({
  classes,
  activeClassId,
  counts,
  onSelect,
  regions,
  reviewControls,
}: Props) {
  const [classesOpen, setClassesOpen] = useState(false);
  const id = useId();
  return (
    <section
      aria-label="Image inspector"
      className="flex w-full shrink-0 flex-col overflow-y-auto border-t border-line bg-surface md:w-[310px] md:border-l md:border-t-0"
    >
      <div className="flex shrink-0 flex-col gap-3 border-b border-line p-4">
        <div>
          <h2 className="text-base font-semibold">Image inspector</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">Draw a box or review a suggestion.</p>
        </div>
        <Field label="Drawing class" htmlFor={`${id}-class`}>
          <Select
            id={`${id}-class`}
            value={activeClassId ?? ""}
            onChange={(event) => onSelect(event.target.value)}
            disabled={classes.length === 0}
          >
            {classes.length === 0 && <option value="">No classes available</option>}
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.hotkey ? ` (${c.hotkey})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Button
          variant="ghost"
          size="sm"
          className="-mx-1 self-start"
          aria-expanded={classesOpen}
          aria-controls={`${id}-classes`}
          onClick={() => setClassesOpen((open) => !open)}
        >
          <Icon name="chevron-right" size={13} className={classesOpen ? "rotate-90" : undefined} />
          All classes
        </Button>
        {classesOpen && (
          <div id={`${id}-classes`}>
            <ClassSidebar
              classes={classes}
              activeClassId={activeClassId}
              counts={counts}
              onSelect={onSelect}
            />
          </div>
        )}
      </div>
      <div className="flex shrink-0 flex-col gap-3 border-b border-line p-4">{reviewControls}</div>
      <RegionList {...regions} />
    </section>
  );
}
