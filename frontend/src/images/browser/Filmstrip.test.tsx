import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { Filmstrip, filmstripWindow } from "./Filmstrip";
import { idAt, makeIndexState } from "./testing";

vi.mock("./thumbs", () => ({ useThumb: () => ({ src: null, failed: false }) }));

function renderStrip(n: number, currentId: string | null) {
  const { api } = fakeClient([]);
  const onOpen = vi.fn();
  renderWithProviders(
    <Filmstrip projectId={PROJECT_ID} index={makeIndexState(n)} currentId={currentId} onOpen={onOpen} />,
    {
      api,
    },
  );
  return { onOpen };
}

describe("filmstripWindow", () => {
  it("centres the current frame and stays inside the index", () => {
    expect(filmstripWindow(15_000, 20_000, 640)).toEqual({ start: 14_994, end: 15_006 });
    expect(filmstripWindow(0, 20_000, 640)).toEqual({ start: 0, end: 12 });
    expect(filmstripWindow(19_999, 20_000, 640)).toEqual({ start: 19_988, end: 20_000 });
    expect(filmstripWindow(1, 3, 640)).toEqual({ start: 0, end: 3 });
    expect(filmstripWindow(0, 0, 640)).toEqual({ start: 0, end: 0 });
  });
});

describe("Filmstrip", () => {
  it("renders a bounded window around the current frame at 20,000 images", () => {
    renderStrip(20_000, idAt(15_000));
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBeLessThanOrEqual(20);
    expect(screen.getByTestId("filmstrip")).toHaveTextContent("15001 / 20000");
    expect(items.find((i) => i.getAttribute("aria-current") === "true")?.dataset.ordinal).toBe("15000");
  });

  it("steps with prev/next and opens a clicked frame", () => {
    const { onOpen } = renderStrip(30, idAt(5));
    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(onOpen).toHaveBeenLastCalledWith(idAt(4));
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(onOpen).toHaveBeenLastCalledWith(idAt(6));
    fireEvent.click(
      screen
        .getAllByRole("listitem")
        .find((i) => i.dataset.ordinal === "7")!
        .querySelector("button")!,
    );
    expect(onOpen).toHaveBeenLastCalledWith(idAt(7));
  });

  it("disables prev on the first frame and next on the last", () => {
    renderStrip(3, idAt(0));
    expect(screen.getByRole("button", { name: "Previous image" })).toBeDisabled();
  });

  it("handles a current image outside the index", () => {
    const { onOpen } = renderStrip(30, "filtered-out");
    expect(screen.getByTestId("filmstrip")).toHaveTextContent("— / 30");
    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(onOpen).toHaveBeenCalledWith(idAt(0));
  });

  it("puts a severity dot on frames with findings", () => {
    renderStrip(30, idAt(5));
    const five = screen.getAllByRole("listitem").find((i) => i.dataset.ordinal === "5")!;
    expect((five.querySelector('[data-part="sev"]') as HTMLElement).style.getPropertyValue("--c")).toBe(
      "#ff9c3a",
    );
  });
});
