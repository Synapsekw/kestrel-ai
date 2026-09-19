import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useNavigationStore } from "@/store/navigation";
import { BackLink } from "./BackLink";

const show = () =>
  render(
    <MemoryRouter>
      <BackLink projectId="p1" />
    </MemoryRouter>,
  );

describe("BackLink", () => {
  beforeEach(() => useNavigationStore.getState().setContext([], null));

  it("returns to the review of one run with its filter intact", () => {
    useNavigationStore.getState().setContext(["a"], "review", "/p/p1/review?ids=a,b");
    show();
    expect(screen.getByRole("link", { name: "Back to the review queue" })).toHaveAttribute(
      "href",
      "/p/p1/review?ids=a,b",
    );
  });

  it("returns to the Data Manager otherwise, also when the editor was opened directly", () => {
    useNavigationStore.getState().setContext(["a"], "data", "/p/p1/data");
    show();
    expect(screen.getByRole("link", { name: "Back to the Data Manager" })).toHaveAttribute(
      "href",
      "/p/p1/data",
    );
  });

  it("falls back to the Data Manager with no context", () => {
    show();
    expect(screen.getByRole("link", { name: "Back to the Data Manager" })).toHaveAttribute(
      "href",
      "/p/p1/data",
    );
  });
});
