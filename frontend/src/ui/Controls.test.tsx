import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { Disclosure } from "./Disclosure";
import { Field } from "./Field";
import { Input } from "./Input";
import { Segmented } from "./Segmented";
import { Switch } from "./Switch";
import { Tooltip } from "./Tooltip";

describe("Switch", () => {
  it("toggles with Space and reports the new value", async () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} label="Show rejected" />);
    const sw = screen.getByRole("switch", { name: "Show rejected" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    sw.focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Checkbox", () => {
  it("is a real checkbox with a label", async () => {
    const onChange = vi.fn();
    render(<Checkbox label="Select all" onChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Select all" });
    await userEvent.click(box);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("Disclosure", () => {
  it("hides its content until opened", async () => {
    render(
      <Disclosure label="More options">
        <p>Epochs</p>
      </Disclosure>,
    );
    expect(screen.queryByText("Epochs")).not.toBeInTheDocument();
    const b = screen.getByRole("button", { name: "More options" });
    expect(b).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(b);
    expect(screen.getByText("Epochs")).toBeInTheDocument();
    expect(b).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Field", () => {
  it("renders the error as an alert and keeps the label linked to the control", () => {
    render(
      <Field label="Name" htmlFor="name" error="Choose a name">
        <Input id="name" />
      </Field>,
    );
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a name");
  });
});

describe("Segmented", () => {
  it("is a radiogroup that reports the chosen value", async () => {
    function Host() {
      const [v, setV] = useState<"grid" | "list">("grid");
      return (
        <Segmented
          label="View"
          value={v}
          onChange={setV}
          options={[
            { value: "grid", label: "Grid" },
            { value: "list", label: "List" },
          ]}
        />
      );
    }
    render(<Host />);
    expect(screen.getByRole("radio", { name: "Grid" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("radio", { name: "List" }));
    expect(screen.getByRole("radio", { name: "List" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Tooltip", () => {
  it("shows on focus at once and on hover after the delay", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <Tooltip label="Import images first">
          <button type="button">Label</button>
        </Tooltip>,
      );
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
      act(() => screen.getByRole("button", { name: "Label" }).focus());
      expect(screen.getByRole("tooltip")).toHaveTextContent("Import images first");
      act(() => screen.getByRole("button", { name: "Label" }).blur());
      expect(screen.queryByRole("tooltip")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
