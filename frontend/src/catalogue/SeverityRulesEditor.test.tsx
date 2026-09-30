import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DEFAULT_SEVERITY_SCALE, SeverityScaleContext, type SeverityLevel } from "@/ui";
import { SeverityRulesEditor } from "./SeverityRulesEditor";
import { MAX_RULES, type RuleDraft } from "./severityRulesModel";

const rule = (when: string, severity: number): RuleDraft => ({ key: `k-${when}`, when, severity });

function Harness({
  initial,
  defaultSeverity,
  onRules,
}: {
  initial: RuleDraft[];
  defaultSeverity: number | null;
  onRules: (rules: RuleDraft[]) => void;
}) {
  const [rules, setRules] = useState(initial);
  return (
    <SeverityRulesEditor
      rules={rules}
      defaultSeverity={defaultSeverity}
      onChange={(next) => {
        setRules(next);
        onRules(next);
      }}
    />
  );
}

function renderRules(
  initial: RuleDraft[],
  opts: { scale?: readonly SeverityLevel[]; defaultSeverity?: number | null } = {},
) {
  const onRules = vi.fn();
  render(
    <SeverityScaleContext.Provider value={opts.scale ?? DEFAULT_SEVERITY_SCALE}>
      <Harness initial={initial} defaultSeverity={opts.defaultSeverity ?? null} onRules={onRules} />
    </SeverityScaleContext.Provider>,
  );
  return onRules;
}

const conditions = () => screen.queryAllByRole("textbox").map((i) => (i as HTMLInputElement).value);

describe("SeverityRulesEditor", () => {
  it("adds rules up to eight, each starting at the type's default severity", () => {
    renderRules([], { defaultSeverity: 3 });
    expect(
      screen.getByText("No rules yet. Add one to say which severity fits which condition."),
    ).toBeInTheDocument();
    const add = screen.getByRole("button", { name: "Add rule" });
    fireEvent.click(add);
    expect(screen.getByLabelText("Rule 1 condition")).toHaveFocus();
    expect(screen.getByLabelText("Rule 1 severity")).toHaveValue("3");
    expect(screen.getByLabelText("Rule 1 condition")).toHaveAttribute("maxlength", "200");
    for (let i = 1; i < MAX_RULES; i += 1) fireEvent.click(add);
    expect(screen.getAllByRole("listitem")).toHaveLength(8);
    expect(add).toBeDisabled();
    expect(screen.getByText("8 of 8")).toBeInTheDocument();
  });

  it("starts a new rule at the lowest level when the default severity is not on the scale", () => {
    renderRules([], { scale: DEFAULT_SEVERITY_SCALE.slice(0, 3), defaultSeverity: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Add rule" }));
    expect(screen.getByLabelText("Rule 1 severity")).toHaveValue("1");
  });

  it("Alt+↓ and Alt+↑ move the focused rule, keep focus on it and announce the position", () => {
    renderRules([rule("A", 1), rule("B", 2), rule("C", 3)]);
    const a = screen.getByLabelText("Rule 1 condition");
    a.focus();
    fireEvent.keyDown(a, { key: "ArrowDown", altKey: true });
    expect(conditions()).toEqual(["B", "A", "C"]);
    expect(screen.getByLabelText("Rule 2 condition")).toHaveValue("A");
    expect(screen.getByLabelText("Rule 2 condition")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Rule moved to position 2 of 3");

    fireEvent.keyDown(screen.getByLabelText("Rule 2 condition"), { key: "ArrowUp", altKey: true });
    expect(conditions()).toEqual(["A", "B", "C"]);
    // At the top, and without Alt, nothing moves.
    fireEvent.keyDown(screen.getByLabelText("Rule 1 condition"), { key: "ArrowUp", altKey: true });
    fireEvent.keyDown(screen.getByLabelText("Rule 1 condition"), { key: "ArrowDown" });
    expect(conditions()).toEqual(["A", "B", "C"]);

    // The severity select moves its rule too, and keeps focus.
    fireEvent.keyDown(screen.getByLabelText("Rule 3 severity"), { key: "ArrowUp", altKey: true });
    expect(conditions()).toEqual(["A", "C", "B"]);
    expect(screen.getByLabelText("Rule 2 severity")).toHaveFocus();
    expect(screen.getByLabelText("Rule 2 severity")).toHaveValue("3");
  });

  it("the move buttons keep focus with the moved rule, and fall back to its condition at the top", () => {
    renderRules([rule("A", 1), rule("B", 2), rule("C", 3)]);
    fireEvent.click(screen.getByRole("button", { name: "Move rule 1 down" }));
    expect(conditions()).toEqual(["B", "A", "C"]);
    expect(screen.getByRole("button", { name: "Move rule 2 down" })).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: "Move rule 2 up" }));
    expect(conditions()).toEqual(["A", "B", "C"]);
    expect(screen.getByRole("button", { name: "Move rule 1 up" })).toBeDisabled();
    expect(screen.getByLabelText("Rule 1 condition")).toHaveFocus();
    expect(screen.getByRole("button", { name: "Move rule 3 down" })).toBeDisabled();
  });

  it("removing a rule focuses the next one, and removing the last focuses Add rule", () => {
    const onRules = renderRules([rule("A", 1), rule("B", 2)]);
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }));
    expect(conditions()).toEqual(["B"]);
    expect(screen.getByLabelText("Rule 1 condition")).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("Rule 1 removed");
    fireEvent.click(screen.getByRole("button", { name: "Remove rule 1" }));
    expect(conditions()).toEqual([]);
    expect(onRules).toHaveBeenLastCalledWith([]);
    expect(screen.getByRole("button", { name: "Add rule" })).toHaveFocus();
  });

  it("a rule whose level left the scale is flagged and keeps its value until changed", () => {
    const onRules = renderRules([rule("Wide", 4)], { scale: DEFAULT_SEVERITY_SCALE.slice(0, 3) });
    const select = screen.getByLabelText("Rule 1 severity");
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveDisplayValue("Level 4 (removed)");
    expect(select).toHaveAccessibleDescription(
      "Level 4 is no longer on the severity scale. Choose another level.",
    );
    fireEvent.change(select, { target: { value: "3" } });
    expect(onRules).toHaveBeenLastCalledWith([{ key: "k-Wide", when: "Wide", severity: 3 }]);
    expect(screen.queryByText(/no longer on the severity scale/)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Level 4 (removed)" })).not.toBeInTheDocument();
  });
});
