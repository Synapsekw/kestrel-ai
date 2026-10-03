import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { reportConfig } from "@/test/reportBuilderFixtures";
import { SeverityScaleContext } from "@/ui";
import { SectionOptions } from "./SectionOptions";

const sectionOf = (key: string) => {
  const found = reportConfig().sections.find((s) => s.key === key);
  // The shared fixture keeps eight sections; asset_summary is built locally.
  return (found ?? { key, enabled: true, options: {} }) as Parameters<typeof SectionOptions>[0]["section"];
};

describe("SectionOptions for the asset report (spec 2026-10-02-asset-findings §10)", () => {
  it("offers the four asset columns", () => {
    const onChange = vi.fn();
    render(<SectionOptions section={sectionOf("findings_table")} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Zone"));
    expect(onChange.mock.calls[0][0].columns).toContain("zone");
    for (const name of ["Side", "Height", "Sightings"])
      expect(screen.getByLabelText(name)).toBeInTheDocument();
  });

  it("sets the pages' minimum severity, and clears it", () => {
    const onChange = vi.fn();
    render(<SectionOptions section={sectionOf("finding_pages")} onChange={onChange} />);
    const select = screen.getByLabelText("Pages for");
    fireEvent.change(select, { target: { value: "2" } });
    expect(onChange).toHaveBeenLastCalledWith({ min_severity: 2 });
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenLastCalledWith({ min_severity: null });
  });

  it("names the pages' floors from the project severity scale", () => {
    const scale = [
      { level: 1, name: "Light", colour: "#3fb68e" },
      { level: 2, name: "Significant", colour: "#e2bf2e" },
      { level: 3, name: "Severe", colour: "#ff5a4f" },
    ];
    render(
      <SeverityScaleContext.Provider value={scale}>
        <SectionOptions section={sectionOf("finding_pages")} onChange={vi.fn()} />
      </SeverityScaleContext.Provider>,
    );
    const options = Array.from(screen.getByLabelText("Pages for").querySelectorAll("option"));
    expect(options.map((o) => [o.value, o.textContent])).toEqual([
      ["", "Every finding"],
      ["1", "Light and above"],
      ["2", "Significant and above"],
      ["3", "Severe and above"],
    ]);
  });

  it("switches the asset summary's map and tables", () => {
    const onChange = vi.fn();
    render(<SectionOptions section={sectionOf("asset_summary")} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch", { name: "Findings map" }));
    expect(onChange).toHaveBeenLastCalledWith({ show_map: false });
    fireEvent.click(screen.getByRole("switch", { name: "Zone and side tables" }));
    expect(onChange).toHaveBeenLastCalledWith({ show_tables: false });
  });
});
