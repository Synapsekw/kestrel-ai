import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SLAB, profileCaption, type ProfileData } from "./profileView";
import { ProfilePanel } from "./ProfilePanel";

const line = {
  a: { x: 0, y: 0, z: 5, uncertainty_m: 0.02 },
  b: { x: 12, y: 0, z: 5, uncertainty_m: 0.02 },
  thicknessM: 0.2,
};
const three: ProfileData = { s: [0, 1, 2], z: [5, 6, 5], rgb: null, count: 3 };
const none: ProfileData = { s: [], z: [], rgb: null, count: 0 };

beforeEach(() => {
  // jsdom has no 2D canvas: the panel draws nothing and must not throw.
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});

describe("profile panel", () => {
  it("captions the preview and the stored profile", () => {
    expect(profileCaption("preview", three)).toBe("Preview · display points");
    expect(profileCaption("preview", null)).toBe("Preview · display points");
    expect(profileCaption("full", { ...three, count: 200000 })).toBe("Full resolution · 200 000 points");
  });

  it("an empty slab says so in the preview and in full resolution", () => {
    expect(profileCaption("preview", none)).toBe(EMPTY_SLAB);
    expect(profileCaption("full", none)).toBe(EMPTY_SLAB);
    render(
      <ProfilePanel
        line={line}
        data={none}
        source="full"
        status="ready"
        error={null}
        onSaveDistance={vi.fn()}
      />,
    );
    expect(screen.getByTestId("profile-caption")).toHaveTextContent(
      "No points in this slab; widen the thickness",
    );
  });

  it("shows a failed profile's reason and retries it, keeping the preview", async () => {
    const onRetry = vi.fn().mockResolvedValue(undefined);
    render(
      <ProfilePanel
        line={line}
        data={three}
        source="preview"
        status="failed"
        error="the source file is not reachable: D:/c.las"
        onRetry={onRetry}
        onSaveDistance={vi.fn()}
      />,
    );
    expect(screen.getByText("the source file is not reachable: D:/c.las")).toBeInTheDocument();
    expect(screen.getByTestId("profile-caption")).toHaveTextContent("Preview · display points");
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("disables Retry while its own request is pending, and does not fire twice", async () => {
    let resolve: () => void = () => {};
    const onRetry = vi.fn().mockReturnValue(
      new Promise<void>((r) => {
        resolve = r;
      }),
    );
    render(
      <ProfilePanel
        line={line}
        data={three}
        source="preview"
        status="failed"
        error="boom"
        onRetry={onRetry}
        onSaveDistance={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Retry" });
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(onRetry).toHaveBeenCalledOnce();
    resolve();
  });

  it("offers Save as distance only after two profile clicks, and collapses", async () => {
    render(
      <ProfilePanel
        line={line}
        data={three}
        source="full"
        status="ready"
        error={null}
        onSaveDistance={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Save as distance" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Hide" }));
    expect(screen.queryByTestId("profile-canvas")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(screen.getByTestId("profile-canvas")).toBeInTheDocument();
  });
});
