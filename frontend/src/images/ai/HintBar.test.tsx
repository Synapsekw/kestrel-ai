import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { exampleProject, fakeClient } from "@/test/fixtures";
import { wsGet } from "./bridge";
import { AiHosts } from "./AiHosts";
import { useAiStore } from "./aiStore";
import { HintBar } from "./HintBar";
import { renderAi, resetAll, seedWorkspace, suggestion } from "./testing";

const project = { method: "GET", path: /\/projects\/[^/]+$/, body: exampleProject };
beforeEach(() => resetAll());

describe("HintBar", () => {
  it("counts the visible suggestions and shows the keys", () => {
    seedWorkspace([suggestion("a", 0.9), suggestion("b", 0.8)]);
    const { api } = fakeClient([project]);
    renderAi(<HintBar />, api);
    expect(screen.getByText("2 AI suggestions on this image")).toBeTruthy();
    expect(screen.getByText("accept")).toBeTruthy();
    expect(screen.getByText("reject")).toBeTruthy();
    expect(screen.getByText("next")).toBeTruthy();
  });

  it("stays while everything is below the threshold, so the threshold can come down", () => {
    seedWorkspace([suggestion("a", 0.2)]);
    act(() => wsGet().setThreshold(0.5));
    const { api } = fakeClient([project]);
    renderAi(<HintBar />, api);
    expect(screen.getByText("0 AI suggestions on this image")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Hide suggestions below this confidence"), {
      target: { value: "0" },
    });
    expect(wsGet().threshold).toBe(0);
  });

  it("is absent with no suggestions at all, or when G hid them", () => {
    seedWorkspace([]);
    const { api } = fakeClient([project]);
    const { container } = renderAi(<HintBar />, api);
    expect(container.textContent).toBe("");
  });

  it("is purely presentational: the bulk confirm opens from AiHosts while the hint bar is hidden (I4)", () => {
    seedWorkspace([suggestion("a", 0.9)]);
    act(() => wsGet().toggleSuggestions());
    const { api } = fakeClient([project]);
    renderAi(
      <>
        <HintBar />
        <AiHosts projectId="p" />
      </>,
      api,
    );
    expect(screen.queryByTestId("ai-hint-bar")).toBeNull();
    act(() => useAiStore.getState().askConfirm({ action: "reject", ids: ["a"] }));
    expect(screen.getByTestId("ai-bulk-confirm")).toBeTruthy();
  });
});
