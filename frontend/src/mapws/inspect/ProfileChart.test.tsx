import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ProfileChart, type ChartSeries } from "./ProfileChart";

const stations = [0, 10, 20, 30, 40, 50];
const aug: ChartSeries = {
  id: "a",
  label: "DSM 14 Aug",
  role: "left",
  z: [600, 601, 602, null, 604, 605],
};
const sep: ChartSeries = {
  id: "s",
  label: "DSM 14 Sep",
  role: "right",
  z: [600, 603, 601, 603, 606, 605],
};
const design: ChartSeries = {
  id: "d",
  label: "Site plan rev C",
  role: "design",
  z: [599, 599, 599, 599, 599, 599],
};

describe("ProfileChart", () => {
  it("draws one line per surface in its date colour, the design dashed, with a legend", () => {
    render(<ProfileChart stations={stations} series={[aug, sep, design]} cursor={null} />);
    const paths = screen.getAllByTestId("profile-series");
    expect(paths.map((p) => p.getAttribute("data-role"))).toEqual(["left", "right", "design"]);
    expect(paths[0]).toHaveClass("stroke-info");
    expect(paths[1]).toHaveClass("stroke-accent");
    expect(paths[2]).toHaveAttribute("stroke-dasharray", "5 4");
    expect(screen.getByText("Site plan rev C")).toBeInTheDocument();
    expect(
      screen.getByRole("img", {
        name: /Elevation profile along 50.00 m, 3 surfaces/,
      }),
    ).toBeInTheDocument();
  });

  it("shades cut and fill between the first two surfaces, and not with one", () => {
    const { rerender } = render(
      <ProfileChart stations={stations} series={[aug, sep, design]} cursor={null} />,
    );
    expect(screen.getByTestId("profile-cut")).toHaveClass("fill-danger");
    expect(screen.getByTestId("profile-fill")).toHaveClass("fill-ok");
    rerender(<ProfileChart stations={stations} series={[aug]} cursor={null} />);
    expect(screen.queryByTestId("profile-cut")).toBeNull();
  });

  it("breaks the line over a gap", () => {
    render(<ProfileChart stations={stations} series={[aug]} cursor={null} />);
    const d = screen.getByTestId("profile-series").getAttribute("d") ?? "";
    expect((d.match(/M/g) ?? []).length).toBe(2);
  });

  it("shows the empty state when no height is known", () => {
    render(
      <ProfileChart stations={stations} series={[{ ...aug, z: stations.map(() => null) }]} cursor={null} />,
    );
    expect(screen.getByText("No elevation along this line.")).toBeInTheDocument();
  });

  it("reports the hovered station and clears it on leave", () => {
    const onCursor = vi.fn();
    render(<ProfileChart stations={stations} series={[aug, sep]} cursor={null} onCursor={onCursor} />);
    vi.spyOn(screen.getByTestId("profile-chart"), "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 300,
      height: 170,
      right: 300,
      bottom: 170,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    const hit = screen.getByTestId("profile-hit");
    fireEvent.mouseMove(hit, { clientX: 40 + 252 * 0.4 });
    expect(onCursor).toHaveBeenLastCalledWith(2);
    fireEvent.mouseLeave(hit);
    expect(onCursor).toHaveBeenLastCalledWith(null);
  });

  it("draws the cursor with a dot on every series that has a height there", () => {
    render(<ProfileChart stations={stations} series={[aug, sep]} cursor={3} />);
    expect(screen.getByTestId("profile-cursor").querySelectorAll("circle")).toHaveLength(1); // aug has a gap
  });
});
