import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Registry, useRegistry } from "./registry";

interface Item {
  id: string;
  label: string;
}

function List({ registry }: { registry: Registry<Item> }) {
  const items = useRegistry(registry);
  return <p>{items.map((i) => i.label).join(",") || "empty"}</p>;
}

describe("Registry (R-W1-1)", () => {
  it("registers, replaces by id and unregisters", () => {
    const r = new Registry<Item>();
    const offA = r.register({ id: "a", label: "A" });
    r.register({ id: "b", label: "B" });
    expect(r.all().map((i) => i.label)).toEqual(["A", "B"]);
    const offA2 = r.register({ id: "a", label: "A2" });
    expect(r.get("a")?.label).toBe("A2");
    offA(); // a stale unregister does not remove the replacement
    expect(r.get("a")?.label).toBe("A2");
    offA2();
    expect(r.get("a")).toBeUndefined();
  });

  it("notifies subscribers and bumps the version", () => {
    const r = new Registry<Item>();
    const spy = vi.fn();
    const off = r.subscribe(spy);
    const v0 = r.getVersion();
    r.register({ id: "a", label: "A" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(r.getVersion()).toBe(v0 + 1);
    off();
    r.register({ id: "b", label: "B" });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-renders a component when a plugin registers", () => {
    const r = new Registry<Item>();
    render(<List registry={r} />);
    expect(screen.getByText("empty")).toBeInTheDocument();
    act(() => {
      r.register({ id: "x", label: "X" });
    });
    expect(screen.getByText("X")).toBeInTheDocument();
  });
});
