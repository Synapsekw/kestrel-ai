import { useState } from "react";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./Checkbox";
import { Disclosure } from "./Disclosure";
import { Field } from "./Field";
import { Input, Select } from "./Input";
import { Kbd, KeyChord } from "./Kbd";
import { Pill } from "./Pill";
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

  it("Segmented: a disabled option cannot be chosen", async () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Colour"
        value="elevation"
        onChange={onChange}
        options={[
          { value: "rgb", label: "RGB", disabled: true },
          { value: "elevation", label: "Elevation" },
        ]}
      />,
    );
    const rgb = screen.getByRole("radio", { name: "RGB" });
    expect(rgb).toBeDisabled();
    await userEvent.click(rgb);
    expect(onChange).not.toHaveBeenCalled();
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

describe("Select", () => {
  // cx() only joins classes, and Tailwind emits w-full after w-[4.5rem], so a wrapper carrying
  // both renders full width and squeezes its neighbours (the class-name fields in settings).
  it("lets a caller's wrapper width replace the default full width", () => {
    render(
      <Select aria-label="Hotkey" wrapperClassName="w-[4.5rem]">
        <option value="">none</option>
      </Select>,
    );
    const wrapper = screen.getByRole("combobox", { name: "Hotkey" }).parentElement!;
    expect(wrapper.className).toContain("w-[4.5rem]");
    expect(wrapper.className).not.toContain("w-full");
  });

  it("is full width when the caller gives no wrapper class", () => {
    render(
      <Select aria-label="Class">
        <option value="">none</option>
      </Select>,
    );
    expect(screen.getByRole("combobox", { name: "Class" }).parentElement!.className).toContain("w-full");
  });
});

describe("Aero glass controls", () => {
  it("fields sit on the field token with a quiet border, and a danger border when invalid", () => {
    render(
      <>
        <Input aria-label="Name" />
        <Input aria-label="Folder" invalid />
      </>,
    );
    const name = screen.getByLabelText("Name");
    expect(name.className).toContain("bg-field");
    expect(name.className).toMatch(/(^| )border-line( |$)/);
    const folder = screen.getByLabelText("Folder");
    expect(folder.className).toContain("border-danger");
    expect(folder).toHaveAttribute("aria-invalid", "true");
  });

  it("Kbd is a mono key cap", () => {
    render(<Kbd>K</Kbd>);
    const cap = screen.getByText("K");
    expect(cap.tagName).toBe("KBD");
    expect(cap.className).toContain("font-mono");
  });

  it("KeyChord renders a chord as a row of key caps", () => {
    const { container } = render(<KeyChord chord="Shift+H" />);
    const caps = [...container.querySelectorAll("kbd")];
    expect(caps.map((k) => k.textContent)).toEqual(["Shift", "H"]);
  });

  it("Pill keeps the inverse tone for old callers, adds info, and pulses only when live", () => {
    render(
      <>
        <Pill tone="inverse">old</Pill>
        <Pill tone="info">reviewed</Pill>
        <Pill tone="accent" live>
          running
        </Pill>
        <Pill tone="ok" dot>
          done
        </Pill>
      </>,
    );
    expect(screen.getByText("old").className).toContain("bg-tip");
    expect(screen.getByText("reviewed").className).toContain("text-info");
    const liveDot = screen.getByText("running").querySelector('[aria-hidden="true"]')!;
    expect(liveDot.className).toContain("animate-pulse-dot");
    expect(liveDot.className).toContain("reduce-motion:animate-none");
    expect(screen.getByText("done").querySelector('[aria-hidden="true"]')!.className).not.toContain(
      "animate",
    );
  });

  it("Switch slides its thumb on the base duration and stops under reduced motion", () => {
    render(<Switch checked onChange={() => {}} label="Suggestions" />);
    const thumb = screen.getByRole("switch", { name: "Suggestions" }).querySelector("[data-part='thumb']")!;
    expect(thumb.className).toContain("duration-base");
    expect(thumb.className).toContain("reduce-motion:transition-none");
    expect(thumb.className).toContain("translate-x-3.5");
  });

  it("Checkbox draws a control-line box that turns accent when checked", () => {
    render(<Checkbox label="Reviewed only" />);
    const box = screen.getByRole("checkbox", { name: "Reviewed only" }).nextElementSibling!;
    expect(box.className).toContain("border-control-line");
    expect(box.className).toContain("peer-checked:bg-accent");
  });
});
