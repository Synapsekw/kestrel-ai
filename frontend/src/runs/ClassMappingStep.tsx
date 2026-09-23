import type { ClassDef } from "@contract/client";
import { Button, Select } from "@/ui";
import { IGNORE, NEW, type Choice } from "./classMapping";

/**
 * One row per model class the project has no class for: map it to a project class, add it as a
 * new class, or ignore it (its detections are not kept). Asked once per model; the answer is
 * remembered for the next run.
 */
export function ClassMappingStep({
  modelName,
  unmapped,
  classes,
  choices,
  onChange,
}: {
  modelName: string;
  unmapped: string[];
  classes: ClassDef[];
  choices: Record<string, Choice>;
  onChange: (choices: Record<string, Choice>) => void;
}) {
  const setAll = (choice: Choice) =>
    onChange(Object.fromEntries(unmapped.map((name) => [name, choices[name] || choice])));
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">
        {`${modelName} finds ${unmapped.length === 1 ? "a class" : `${unmapped.length} classes`} this project does not have yet. Choose what each one becomes. This is asked once per model.`}
      </p>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-muted">
            <th className="py-1.5 font-medium">Model class</th>
            <th className="font-medium">Counts as</th>
          </tr>
        </thead>
        <tbody>
          {unmapped.map((name) => {
            const id = `map-${name.replace(/\W+/g, "-")}`;
            return (
              <tr key={name} className="border-t border-line">
                <td className="py-2 pr-3 text-ink">
                  <label htmlFor={id}>{name}</label>
                </td>
                <td className="py-2">
                  <Select
                    id={id}
                    value={choices[name] ?? ""}
                    onChange={(e) => onChange({ ...choices, [name]: e.target.value })}
                  >
                    <option value="">Choose</option>
                    <option value={NEW}>{`Add "${name}" as a new class`}</option>
                    <option value={IGNORE}>Ignore (do not keep these detections)</option>
                    {classes.length > 0 && (
                      <optgroup label="Project classes">
                        {classes.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </optgroup>
                    )}
                  </Select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {unmapped.length > 1 && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => setAll(NEW)}>
            Add the rest as new classes
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAll(IGNORE)}>
            Ignore the rest
          </Button>
        </div>
      )}
    </div>
  );
}
