import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BlockOf, SectionKey } from "@/api/reports";
import { FIXTURE_BLOCKS } from "../fixtures";
import { HeadingBlock } from "./HeadingBlock";
import { KpisBlock } from "./KpisBlock";
import { KvBlock } from "./KvBlock";
import { SeverityMark } from "./marks";
import { PageBreakBlock } from "./PageBreakBlock";
import { ParaBlock } from "./ParaBlock";
import { TableBlock } from "./TableBlock";

const pick = (section: SectionKey, kind: string) => FIXTURE_BLOCKS[section].find((b) => b.kind === kind);

describe("text blocks", () => {
  it("renders a heading one level under the preview's section title", () => {
    render(<HeadingBlock block={{ kind: "heading", level: 1, text: "Top" }} />);
    render(<HeadingBlock block={{ kind: "heading", level: 3, text: "Deep" }} />);
    render(<HeadingBlock block={{ kind: "heading", level: 9, text: "Capped" }} />);
    expect(screen.getByRole("heading", { level: 4, name: "Top" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 6, name: "Deep" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 6, name: "Capped" })).toBeInTheDocument();
  });

  it("splits a paragraph block on blank lines and marks a note with a rule", () => {
    const { container } = render(<ParaBlock block={pick("summary", "para") as BlockOf<"para">} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    const note = render(<ParaBlock block={{ kind: "para", text: "Watch this", style: "note" }} />);
    expect((note.container.firstChild as HTMLElement).style.borderLeft).toContain("solid");
  });

  it("renders kv rows as row headers and values", () => {
    render(<KvBlock block={pick("appendix", "kv") as BlockOf<"kv">} />);
    expect(screen.getByRole("rowheader", { name: "Client" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Acme Build" })).toBeInTheDocument();
  });

  it("renders KPI values with their delta as words next to a tone dot", () => {
    render(<KpisBlock block={pick("summary", "kpis") as BlockOf<"kpis">} />);
    expect(screen.getByText("38")).toBeInTheDocument();
    expect(screen.getByText("+4 since v1")).toBeInTheDocument();
    expect(screen.queryByText("null")).toBeNull();
  });

  it("renders a table with column headers, aligned cells and an empty-rows line", () => {
    render(<TableBlock block={pick("findings_table", "table") as BlockOf<"table">} />);
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((h) => h.textContent),
    ).toEqual(["No.", "Type", "Severity", "Area m²"]);
    expect(within(table).getByRole("cell", { name: "0.40" }).style.textAlign).toBe("right");
    render(
      <TableBlock
        block={{
          kind: "table",
          columns: [{ key: "a", label: "A", align: "left", width_mm: null, style: "text" }],
          rows: [],
          repeat_header: true,
        }}
      />,
    );
    expect(screen.getByText("No rows")).toBeInTheDocument();
  });

  it("renders a page break as an invisible marker", () => {
    const { container } = render(<PageBreakBlock />);
    expect(container.querySelector('[data-block="page_break"]')).toHaveAttribute("aria-hidden", "true");
  });

  it("prints severity as a word next to its dot, and Ungraded without a level", () => {
    render(<SeverityMark level={3} name="Major" colour="#FF9C3A" />);
    render(<SeverityMark level={null} name={null} colour={null} />);
    expect(screen.getByText("Major")).toBeInTheDocument();
    expect(screen.getByText("Ungraded")).toBeInTheDocument();
  });

  it("prints Ungraded with the grey dot when a level has no severity name (contract: null prints Ungraded)", () => {
    const { container } = render(<SeverityMark level={2} name={null} colour="#E2BF2E" />);
    const mark = container.querySelector("[data-severity]") as HTMLElement;
    expect(mark).toHaveTextContent("Ungraded");
    expect(mark).toHaveAttribute("data-severity", "ungraded");
    expect(screen.queryByText("Level 2")).toBeNull();
    const dot = mark.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(dot.style.background).toBe("rgb(154, 152, 176)");
  });
});
