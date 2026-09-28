import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { LocationProbe } from "@/test/render";
import { DELETED_TOAST, useFrameGuard } from "./useFrameGuard";

const toast = vi.fn();
vi.mock("@/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ui")>()),
  toast: (...a: unknown[]) => toast(...a),
}));

function Page({ ids }: { ids: string[] | null }) {
  const { imageId = null } = useParams();
  useFrameGuard("p", imageId, ids);
  return null;
}
function mount(url: string, ids: string[] | null) {
  const tree = (i: string[] | null) => (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/p/:projectId/images/:imageId?" element={<Page ids={i} />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
  const r = render(tree(ids));
  return { update: (i: string[] | null) => r.rerender(tree(i)) };
}
const loc = () => screen.getByTestId("location").textContent;

beforeEach(() => toast.mockClear());

describe("useFrameGuard (§16)", () => {
  it("moves to the entry now at the old ordinal and toasts once", () => {
    const { update } = mount("/p/p/images/b", ["a", "b", "c"]);
    update(["a", "c"]);
    expect(loc()).toBe("/p/p/images/c");
    expect(toast).toHaveBeenCalledExactlyOnceWith("info", DELETED_TOAST);
  });
  it("takes the previous one when the last frame goes", () => {
    const { update } = mount("/p/p/images/c", ["a", "b", "c"]);
    update(["a", "b"]);
    expect(loc()).toBe("/p/p/images/b");
  });
  it("lands on the tab when the index empties, without looping", () => {
    const { update } = mount("/p/p/images/a", ["a"]);
    update([]);
    expect(loc()).toBe("/p/p/images");
    update([]);
    expect(toast).toHaveBeenCalledOnce();
  });
  it("a filter change that drops the frame is not a delete", () => {
    const { update } = mount("/p/p/images/b", ["a", "b", "c"]);
    update(null); // the new filter's index is loading
    update(["a", "c"]);
    expect(loc()).toBe("/p/p/images/b");
    expect(toast).not.toHaveBeenCalled();
  });
  it("leaves a deep link outside the filters alone", () => {
    mount("/p/p/images/z", ["a", "b"]);
    expect(loc()).toBe("/p/p/images/z");
    expect(toast).not.toHaveBeenCalled();
  });
});
