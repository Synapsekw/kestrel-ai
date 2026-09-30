import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { reportConfig } from "@/test/reportBuilderFixtures";
import type { Sections } from "./builderModel";
import { SectionList } from "./SectionList";

function Harness({ onChange, onShow }: { onChange: (s: Sections) => void; onShow?: (key: string) => void }) {
  const [sections, setSections] = useState(reportConfig().sections);
  return (
    <SectionList
      sections={sections}
      onChange={(s) => {
        setSections(s);
        onChange(s);
      }}
      onShow={onShow}
    />
  );
}

const setup = (onShow?: (key: string) => void) => {
  const onChange = vi.fn();
  render(<Harness onChange={onChange} onShow={onShow} />);
  return onChange;
};
const rows = () => within(screen.getByRole("list", { name: "Sections" })).getAllByRole("listitem");
const order = () => rows().map((r) => r.getAttribute("data-key"));
const row = (label: string) => rows().find((r) => within(r).queryByRole("switch", { name: label }))!;

function dataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (k: string, v: string) => void data.set(k, v),
    getData: (k: string) => data.get(k) ?? "",
    get types() {
      return [...data.keys()];
    },
    effectAllowed: "all",
    dropEffect: "move",
  };
}

describe("SectionList", () => {
  it("lists the eight sections with the cover pinned first", () => {
    setup();
    expect(order()).toEqual([
      "cover",
      "summary",
      "findings_table",
      "finding_pages",
      "measurements",
      "comparison",
      "object_counts",
      "appendix",
    ]);
    expect(within(row("Cover")).queryByRole("button", { name: /^Reorder/ })).toBeNull();
    expect(row("Cover")).toHaveAttribute("draggable", "false");
    expect(within(row("Appendix")).getByRole("button", { name: "Reorder Appendix" })).toBeInTheDocument();
  });

  it("toggles a section", () => {
    const onChange = setup();
    fireEvent.click(screen.getByRole("switch", { name: "Appendix" }));
    expect(onChange.mock.calls.at(-1)![0].find((s: { key: string }) => s.key === "appendix").enabled).toBe(
      false,
    );
  });

  it("moves a section with Alt+ArrowUp and announces it", () => {
    setup();
    const handle = screen.getByRole("button", { name: "Reorder Measurements" });
    handle.focus();
    fireEvent.keyDown(handle, { key: "ArrowUp", altKey: true });
    expect(order().slice(3, 5)).toEqual(["measurements", "finding_pages"]);
    expect(screen.getByRole("status")).toHaveTextContent("Measurements moved to position 4 of 8");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reorder Measurements" }));
  });

  it("moves with Alt+ArrowDown from any control in the row", () => {
    setup();
    fireEvent.keyDown(screen.getByRole("switch", { name: "Executive summary" }), {
      key: "ArrowDown",
      altKey: true,
    });
    expect(order().slice(1, 3)).toEqual(["findings_table", "summary"]);
  });

  it("never moves anything above the cover, nor the cover", () => {
    const onChange = setup();
    fireEvent.keyDown(screen.getByRole("switch", { name: "Executive summary" }), {
      key: "ArrowUp",
      altKey: true,
    });
    fireEvent.keyDown(screen.getByRole("switch", { name: "Cover" }), { key: "ArrowDown", altKey: true });
    fireEvent.keyDown(screen.getByRole("switch", { name: "Appendix" }), { key: "ArrowUp" }); // no Alt
    expect(onChange).not.toHaveBeenCalled();
  });

  it("moves a section by drag and drop", () => {
    setup();
    const dt = dataTransfer();
    fireEvent.dragStart(row("Appendix"), { dataTransfer: dt });
    fireEvent.dragOver(row("Executive summary"), { dataTransfer: dt });
    fireEvent.drop(row("Executive summary"), { dataTransfer: dt });
    expect(order().slice(0, 3)).toEqual(["cover", "appendix", "summary"]);
    expect(screen.getByRole("status")).toHaveTextContent("Appendix moved to position 2 of 8");
  });

  it("edits a section's options", () => {
    const onChange = setup();
    fireEvent.click(within(row("Finding pages")).getByRole("button", { name: "Options" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Photos per finding" }), {
      target: { value: "0" },
    });
    const pages = onChange.mock.calls.at(-1)![0].find((s: { key: string }) => s.key === "finding_pages");
    expect(pages.options).toMatchObject({ photos_max: 0, comments: "last" });
    fireEvent.click(screen.getByRole("radio", { name: "All" }));
    expect(
      onChange.mock.calls.at(-1)![0].find((s: { key: string }) => s.key === "finding_pages").options.comments,
    ).toBe("all");
  });

  it("clamps the photo count to 0–6", () => {
    const onChange = setup();
    fireEvent.click(within(row("Finding pages")).getByRole("button", { name: "Options" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Photos per finding" }), {
      target: { value: "9" },
    });
    expect(
      onChange.mock.calls.at(-1)![0].find((s: { key: string }) => s.key === "finding_pages").options
        .photos_max,
    ).toBe(6);
  });

  it("edits the table columns and the measurement kinds", () => {
    const onChange = setup();
    fireEvent.click(within(row("Findings table")).getByRole("button", { name: "Options" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Note" }));
    const table = onChange.mock.calls.at(-1)![0].find((s: { key: string }) => s.key === "findings_table");
    expect(table.options.columns).not.toContain("note");
    fireEvent.click(within(row("Measurements")).getByRole("button", { name: "Options" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Volume" }));
    const m = onChange.mock.calls.at(-1)![0].find((s: { key: string }) => s.key === "measurements");
    expect(m.options.kinds).not.toContain("volume");
  });

  // R-7.2 (reports index recon 10, overrides plan Ruling 19): an optional onShow prop puts a quiet
  // "Show <label> in preview" button on every ENABLED row, absent on disabled rows, absent without
  // the prop at all.
  it("shows a preview button on an enabled row when onShow is given, and calls it with the key", () => {
    const onShow = vi.fn();
    setup(onShow);
    const button = within(row("Executive summary")).getByRole("button", {
      name: "Show Executive summary in preview",
    });
    fireEvent.click(button);
    expect(onShow).toHaveBeenCalledWith("summary");
  });

  it("shows no preview button on a disabled section", () => {
    const onShow = vi.fn();
    setup(onShow);
    // comparison starts disabled in the fixture
    expect(within(row("Survey comparison")).queryByRole("button", { name: /^Show / })).toBeNull();
  });

  it("shows no preview button anywhere when onShow is not given", () => {
    setup();
    expect(screen.queryByRole("button", { name: /^Show .+ in preview$/ })).toBeNull();
  });
});
