import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ProfileSheet } from "./ProfileSheet";

describe("ProfileSheet", () => {
  it("closes on Escape from inside the sheet, without the workspace also seeing the key", () => {
    const onClose = vi.fn();
    const onWindowKey = vi.fn();
    window.addEventListener("keydown", onWindowKey);
    try {
      render(
        <ProfileSheet
          title="Length 1"
          stations={[0, 1]}
          series={[]}
          cursor={null}
          onCursor={() => {}}
          onClose={onClose}
        />,
      );
      const sheet = screen.getByRole("dialog", { name: "Length 1, expanded profile" });
      fireEvent.keyDown(sheet, { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });
});
