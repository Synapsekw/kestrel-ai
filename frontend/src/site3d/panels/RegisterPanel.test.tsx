import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { itemRow } from "@/test/plantFixtures";
import { RegisterPanel } from "./RegisterPanel";

const rows = [
  itemRow(),
  itemRow({
    node: "30-P-0001",
    tag: "30-P-0001",
    name: "Send-out pump 1",
    type: "pump",
    area: "30",
    flags: [{ code: "height_mismatch", value: 1.2, note: null }],
  }),
  itemRow({ node: "untagged-1", tag: null, name: "Pipe rack segment", type: "pipe_rack", area: "30" }),
];
function setup(selectedId: string | null = null) {
  const client = fakeClient(
    [{ method: "GET", path: /\/versions\/3\/items$/, body: { items: rows, next_cursor: null } }] as never,
    { signalSafe: true },
  );
  const onPick = vi.fn();
  renderWithProviders(
    <RegisterPanel
      projectId="p"
      modelId="m1"
      version={3}
      catalogueTypes={["pump", "pipe_rack", "tank_lng"]}
      selectedId={selectedId}
      onPick={onPick}
    />,
    { api: client.api },
  );
  return { ...client, onPick };
}
const lastQuery = (urls: { url: string }[]) => new URL(urls[urls.length - 1].url, "http://x").searchParams;

describe("RegisterPanel", () => {
  it("lists the items with tag, name, type and flags, and a row click picks it", async () => {
    const { onPick } = setup();
    const row = await screen.findByRole("button", { name: /30-P-0001/ });
    expect(row).toHaveTextContent("Send-out pump 1");
    expect(row).toHaveTextContent("1 flag");
    expect(screen.getByRole("button", { name: /untagged/i })).toHaveTextContent("Pipe rack segment");
    fireEvent.click(row);
    expect(onPick).toHaveBeenCalledWith("30-P-0001");
    expect(screen.getByText("3 items")).toBeInTheDocument();
  });

  it("marks the selected row", async () => {
    setup("30-P-0001");
    expect(await screen.findByRole("button", { name: /30-P-0001/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /untagged/i })).toHaveAttribute("aria-pressed", "false");
  });

  it("searches by tag or name after a short pause", async () => {
    const { requests } = setup();
    await screen.findByRole("button", { name: /30-P-0001/ });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search the register" }), {
      target: { value: "pump" },
    });
    await waitFor(() => expect(lastQuery(requests).get("q")).toBe("pump"));
  });

  it("filters by type, area and flag", async () => {
    const { requests } = setup();
    await screen.findByRole("button", { name: /30-P-0001/ });
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "pump" } });
    fireEvent.change(screen.getByLabelText("Flag"), { target: { value: "height_mismatch" } });
    await waitFor(() => expect(lastQuery(requests).get("flag")).toBe("height_mismatch"));
    expect(lastQuery(requests).get("type")).toBe("pump");
    fireEvent.change(screen.getByLabelText("Area"), { target: { value: "30" } });
    await waitFor(() => expect(lastQuery(requests).get("area")).toBe("30"));
  });
});
