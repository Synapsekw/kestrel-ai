import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import type { Filters } from "./builderModel";
import { CLASS_ID, exampleProject, fakeClient, MAP_ID, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { reportConfig } from "@/test/reportBuilderFixtures";
import { ReportFilters } from "./ReportFilters";

const DATA = [
  { id: "s1", type: "image_set", label: "North photos", captured_on: "2026-09-14", status: "ready" },
  { id: MAP_ID, type: "map", label: "Ortho 14 Sep", captured_on: "2026-09-14", status: "ready" },
];

function setup(matchCount: number | null = 38) {
  const onChange = vi.fn();
  function Harness() {
    const [f, setF] = useState<Filters>(reportConfig().filters);
    return (
      <ReportFilters
        projectId={PROJECT_ID}
        filters={f}
        matchCount={matchCount}
        today="2026-09-30"
        onChange={(n) => {
          setF(n);
          onChange(n);
        }}
      />
    );
  }
  const { api, requests } = fakeClient([
    { method: "GET", path: /\/projects\/[^/]+\/data$/, body: { items: DATA, next_cursor: null } },
    { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject },
  ]);
  renderWithProviders(<Harness />, { api });
  const last = (): Filters => onChange.mock.calls.at(-1)![0];
  return { onChange, last, requests };
}

describe("ReportFilters", () => {
  it("shows the live match count", () => {
    setup(38);
    expect(screen.getByRole("status")).toHaveTextContent("38 findings match");
  });

  it("says when it is counting", () => {
    setup(null);
    expect(screen.getByRole("status")).toHaveTextContent("Counting findings…");
  });

  it("sets and clears a severity floor, showing include-ungraded only while a level is chosen", () => {
    const { last } = setup();
    const group = screen.getByRole("group", { name: "Severity at least" });
    expect(screen.queryByRole("checkbox", { name: "Include ungraded findings" })).not.toBeInTheDocument();

    fireEvent.click(within(group).getByRole("button", { name: "Major" }));
    expect(last().severity_min).toBe(3);
    expect(within(group).getByRole("button", { name: "Major" })).toHaveAttribute("aria-pressed", "true");
    expect(last().include_ungraded).toBe(false);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include ungraded findings" }));
    expect(last().include_ungraded).toBe(true);

    fireEvent.click(within(group).getByRole("button", { name: "Any" }));
    expect(last().severity_min).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "Include ungraded findings" })).not.toBeInTheDocument();
  });

  it("toggles statuses", () => {
    const { last } = setup();
    fireEvent.click(screen.getByRole("checkbox", { name: "Closed" }));
    expect(last().statuses).toEqual(["open", "reviewed", "closed"]);
  });

  it("filters to chosen types and back to all", async () => {
    const { last } = setup();
    const group = screen.getByRole("group", { name: "Types" });
    fireEvent.click(await within(group).findByRole("button", { name: "excavator" }));
    expect(last().type_ids).toEqual([CLASS_ID(1)]);
    fireEvent.click(within(group).getByRole("button", { name: "All types" }));
    expect(last().type_ids).toBeNull();
  });

  it("switches the date rule", () => {
    const { last } = setup();
    fireEvent.change(screen.getByRole("combobox", { name: "Date" }), { target: { value: "last_days" } });
    expect(last().date).toMatchObject({ rule: "last_days", days: 30 });
    fireEvent.change(screen.getByRole("spinbutton", { name: "Days" }), { target: { value: "14" } });
    expect(last().date).toMatchObject({ rule: "last_days", days: 14 });
    fireEvent.change(screen.getByRole("combobox", { name: "Date" }), { target: { value: "range" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    expect(last().date).toMatchObject({ rule: "range", from: "2026-09-01", to: "2026-09-30" });
  });

  it("keeps the dates and days inside the contract's bounds", () => {
    const { last } = setup();
    fireEvent.change(screen.getByRole("combobox", { name: "Date" }), { target: { value: "range" } });
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "" } });
    expect(last().date.from).toBeNull();
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "" } });
    expect(last().date.to).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Date" }), { target: { value: "last_days" } });
    const days = screen.getByRole("spinbutton", { name: "Days" });
    expect(days).toHaveAttribute("min", "1");
    expect(days).toHaveAttribute("max", "3650");
    fireEvent.change(days, { target: { value: "99999" } });
    expect(last().date.days).toBe(3650);
  });

  it("lists the data items and treats none ticked as all", async () => {
    const { last, requests } = setup();
    const group = screen.getByRole("group", { name: "Data items" });
    fireEvent.click(await within(group).findByRole("checkbox", { name: "Ortho 14 Sep" }));
    expect(last().data_item_ids).toEqual([MAP_ID]);
    fireEvent.click(within(group).getByRole("checkbox", { name: "Ortho 14 Sep" }));
    expect(last().data_item_ids).toBeNull();
    await waitFor(() => expect(requests.some((r) => /\/data\?limit=200$/.test(r.url))).toBe(true));
  });
});
