import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { ITEM } from "@/test/plantFixtures";
import { ItemPanel } from "./ItemPanel";

function setup(item: unknown = ITEM) {
  const { api } = fakeClient([
    { method: "GET", path: /\/versions\/3\/items\/20-T-0001$/, body: item },
  ] as never);
  const onEdit = vi.fn();
  const onBack = vi.fn();
  renderWithProviders(
    <ItemPanel projectId="p" modelId="m1" version={3} itemId="20-T-0001" onBack={onBack} onEdit={onEdit} />,
    { api },
  );
  return { onEdit, onBack };
}

describe("ItemPanel", () => {
  it("shows the register row: tag, name, type, plant E/N and heights with their source", async () => {
    setup();
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
    expect(screen.getByText("20-T-0001")).toHaveClass("font-mono");
    expect(screen.getByText("tank lng")).toBeInTheDocument();
    expect(screen.getByText("E 100.00 · N 200.00")).toBeInTheDocument();
    expect(screen.getByText("135.00 m")).toBeInTheDocument();
    expect(screen.getByText("From the drawing")).toBeInTheDocument();
  });

  it("confidence reads in sentence case, not the raw code", async () => {
    setup({ ...ITEM, confidence: "low" });
    expect(await screen.findByText("Low")).toBeInTheDocument();
    expect(screen.queryByText("low")).toBeNull();
  });

  it("a footprint with no points has no plant position: Not set, never E 0.00", async () => {
    setup({ ...ITEM, footprint: { kind: "polygon", pts: [] } });
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByText(/E 0\.00/)).toBeNull();
  });

  it("Edit waits while a saved version is still on its way, and says why", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/versions\/3\/items\/20-T-0001$/, body: ITEM },
    ] as never);
    const onEdit = vi.fn();
    renderWithProviders(
      <ItemPanel
        projectId="p"
        modelId="m1"
        version={3}
        itemId="20-T-0001"
        onBack={() => {}}
        onEdit={onEdit}
        editBlocked="Version 4 is still building. Edit when it shows."
      />,
      { api },
    );
    const edit = await screen.findByRole("button", { name: "Edit" });
    expect(edit).toBeDisabled();
    expect(screen.getByText("Version 4 is still building. Edit when it shows.")).toBeInTheDocument();
    fireEvent.click(edit);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("lists the flags in plain words", async () => {
    setup();
    const flags = await screen.findByRole("list", { name: "Flags" });
    expect(flags).toHaveTextContent("Height differs from the scan (1.20 m): Scan top at EL 136.2");
  });

  it("an item without flags shows no flag list", async () => {
    const noFlags: Record<string, unknown> = { ...(ITEM as unknown as Record<string, unknown>) };
    delete noFlags.flags;
    setup(noFlags);
    expect(await screen.findByRole("heading", { name: "LNG tank 1" })).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Flags" })).toBeNull();
  });

  it("Source shows the drawing with the traced region and a way to open it", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    const pop = await screen.findByRole("dialog", { name: "Source" });
    expect(pop.querySelector("img")?.getAttribute("src")).toContain("/drawings/dr-1/thumbnail");
    const region = screen.getByTestId("source-region");
    expect(region.style.left).toBe("10%");
    expect(region.style.width).toBe("20%");
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open the drawing in Maps" })).toHaveAttribute(
      "href",
      "/p/p/maps?sel=drawing:dr-1",
    );
  });

  it("Source encodes the drawing id in the Maps link", async () => {
    setup({ ...ITEM, source: { kind: "drawing", id: "dr 1/a&b", page: null, region: null } });
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    await screen.findByRole("dialog", { name: "Source" });
    expect(screen.getByRole("link", { name: "Open the drawing in Maps" })).toHaveAttribute(
      "href",
      `/p/p/maps?sel=drawing:${encodeURIComponent("dr 1/a&b")}`,
    );
  });

  it("Source says so when the drawing preview fails, and keeps the Maps link", async () => {
    setup();
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    const pop = await screen.findByRole("dialog", { name: "Source" });
    fireEvent.error(pop.querySelector("img")!);
    expect(await screen.findByText("The drawing preview is not available.")).toBeInTheDocument();
    expect(pop.querySelector("img")).toBeNull();
    expect(screen.queryByTestId("source-region")).toBeNull();
    expect(screen.getByRole("link", { name: "Open the drawing in Maps" })).toBeInTheDocument();
  });

  it("Source copes with no page and no region", async () => {
    setup({ ...ITEM, source: { kind: "drawing", id: "dr-1", page: null, region: null } });
    fireEvent.click(await screen.findByRole("button", { name: "Source" }));
    await screen.findByRole("dialog", { name: "Source" });
    expect(screen.queryByTestId("source-region")).toBeNull();
    expect(screen.queryByText(/^Page /)).toBeNull();
    expect(screen.getByRole("link", { name: "Open the drawing in Maps" })).toBeInTheDocument();
  });

  it("Edit hands the full item over; Register goes back", async () => {
    const { onEdit, onBack } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalledWith(ITEM);
    fireEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("an assumed source says so, with no popover", async () => {
    setup({ ...ITEM, source: { kind: "assumed" } });
    expect(await screen.findByText("Assumed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
  });

  it("an operator-edited item says it was edited by hand", async () => {
    setup({ ...ITEM, source: { kind: "operator" } });
    expect(await screen.findByText("Edited by hand")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Source" })).toBeNull();
  });
});
