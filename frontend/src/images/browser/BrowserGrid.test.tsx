import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { EMPTY_SELECTION, type SelectionState } from "@/data/selection";
import { fakeClient, PROJECT_ID } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import { BrowserGrid } from "./BrowserGrid";
import { gridGeometry } from "./gridGeometry";
import { idAt, imageRow, makeIndexState } from "./testing";
import { resetDetailsForTests } from "./useImageDetails";

// jsdom cannot decode images; the loader is exercised in thumbs.test.tsx.
vi.mock("./thumbs", () => ({ useThumb: () => ({ src: null, failed: false }) }));

const idsParam = (url: string) => (new URL(url, "http://fake").searchParams.get("ids") ?? "").split(",");

function renderGrid(n: number, over: Partial<Parameters<typeof BrowserGrid>[0]> = {}) {
  const { api, requests } = fakeClient([
    {
      method: "GET",
      path: /\/images$/,
      body: (r) => ({
        items: idsParam(r.url).map((id) => imageRow(id, Number(id.slice(4)))),
        next_cursor: null,
      }),
    },
  ]);
  const onOpen = vi.fn();
  const onSelectionChange = vi.fn<(s: SelectionState) => void>();
  const index = makeIndexState(n);
  const view = renderWithProviders(
    <BrowserGrid
      projectId={PROJECT_ID}
      index={index}
      currentId={null}
      sort="capture_time"
      order="asc"
      selection={EMPTY_SELECTION}
      onSelectionChange={onSelectionChange}
      onOpen={onOpen}
      {...over}
    />,
    { api },
  );
  return { ...view, requests, onOpen, onSelectionChange, index };
}

describe("BrowserGrid", () => {
  beforeEach(() => resetDetailsForTests());

  it("keeps at most 60 tiles in the DOM at 20,000 images", () => {
    renderGrid(20_000);
    expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(60);
    expect(screen.getByTestId("grid-caption")).toHaveTextContent("of 20000");
  });

  it("renders image #15,000 after scrolling to it, still within the tile budget", () => {
    renderGrid(20_000);
    const grid = screen.getByTestId("browser-grid");
    const { rowH } = gridGeometry(0);
    grid.scrollTop = Math.floor(15_000 / 3) * rowH;
    fireEvent.scroll(grid);
    expect(document.querySelector('[data-ordinal="15000"]')).not.toBeNull();
    expect(screen.getAllByRole("listitem").length).toBeLessThanOrEqual(60);
  });

  it("scrolls the current image into view", () => {
    renderGrid(20_000, { currentId: idAt(15_000) });
    expect(document.querySelector('[data-ordinal="15000"]')).not.toBeNull();
  });

  it("asks details for the visible window only, in one batch", async () => {
    const { requests } = renderGrid(20_000);
    await waitFor(() => expect(requests.length).toBeGreaterThan(0));
    const asked = requests.flatMap((r) => idsParam(r.url));
    expect(asked.length).toBeLessThanOrEqual(60);
    expect(asked[0]).toBe(idAt(0));
    await waitFor(() => expect(screen.getByText("DJI_0000")).toBeInTheDocument());
  });

  it("a click opens the frame; Ctrl/Shift-click selects without opening", () => {
    const { onOpen, onSelectionChange } = renderGrid(30);
    const tile = (i: number) => document.querySelector(`[data-ordinal="${i}"] button`)!;
    fireEvent.click(tile(2));
    expect(onOpen).toHaveBeenCalledWith(idAt(2));
    expect(onSelectionChange).toHaveBeenLastCalledWith({ selected: new Set(), anchor: idAt(2) });
    fireEvent.click(tile(4), { ctrlKey: true });
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect([...onSelectionChange.mock.lastCall![0].selected]).toEqual([idAt(4)]);
  });

  it("badges the finding count on the worst severity's colour, ticks reviewed, marks no location", () => {
    renderGrid(30);
    const tile5 = document.querySelector('[data-ordinal="5"]')!; // 2 findings, severity 3, no GPS
    const badge = tile5.querySelector('[data-part="badge"]') as HTMLElement;
    expect(badge).toHaveTextContent("2");
    expect(badge.style.getPropertyValue("--c")).toBe("#ff9c3a");
    expect(tile5.querySelector('[title="No location"]')).not.toBeNull();
    const tile0 = document.querySelector('[data-ordinal="0"]')!; // reviewed, GPS
    expect(tile0.querySelector('[title="Reviewed"]')).not.toBeNull();
    expect(tile0.querySelector('[title="No location"]')).toBeNull();
    expect(document.querySelector('[data-ordinal="1"] [data-part="badge"]')).toBeNull();
  });

  it("marks the current thumb", () => {
    renderGrid(30, { currentId: idAt(1) });
    expect(document.querySelector('[data-ordinal="1"] button')).toHaveAttribute("aria-current", "true");
  });

  it("asks for a flight filter above 100,000 images", () => {
    renderGrid(0, {
      index: makeIndexState(0, { status: "error", errorCode: "too_many_images", error: "too many" }),
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Pick a flight");
  });

  it("says when nothing matches", () => {
    renderGrid(0);
    expect(screen.getByText("No images match these filters.")).toBeInTheDocument();
  });
});
