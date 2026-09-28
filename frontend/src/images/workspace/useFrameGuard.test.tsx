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

interface Opts {
  filtered?: boolean;
  gone?: boolean;
}
function Page({ ids, opts }: { ids: string[] | null; opts: Opts }) {
  const { imageId = null } = useParams();
  useFrameGuard("p", imageId, ids, { filtered: opts.filtered ?? false, gone: opts.gone ?? false });
  return null;
}
function mount(url: string, ids: string[] | null, first: Opts = {}) {
  const tree = (i: string[] | null, opts: Opts) => (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/p/:projectId/images/:imageId?" element={<Page ids={i} opts={opts} />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>
  );
  const r = render(tree(ids, first));
  return { update: (i: string[] | null, opts: Opts = first) => r.rerender(tree(i, opts)) };
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
  it("a frame that leaves a FILTERED index stays open without a toast (I1)", () => {
    const { update } = mount("/p/p/images/b", ["a", "b", "c"], { filtered: true });
    update(["a", "c"]); // e.g. the first box drawn on an unlabeled frame
    expect(loc()).toBe("/p/p/images/b");
    expect(toast).not.toHaveBeenCalled();
  });
  it("a frame confirmed gone moves on even under filters (I1)", () => {
    const { update } = mount("/p/p/images/b", ["a", "b", "c"], { filtered: true });
    update(["a", "c"]);
    update(["a", "c"], { filtered: true, gone: true });
    expect(loc()).toBe("/p/p/images/c");
    expect(toast).toHaveBeenCalledExactlyOnceWith("info", DELETED_TOAST);
  });
  it("leaves a deep link outside the filters alone", () => {
    mount("/p/p/images/z", ["a", "b"]);
    expect(loc()).toBe("/p/p/images/z");
    expect(toast).not.toHaveBeenCalled();
  });
});
