import { describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { CLASS_ID, exampleClasses, exampleMapRun, fakeClient, PROJECT_ID, runningJob } from "@/test/fixtures";
import { renderWithProviders } from "@/test/render";
import type { MapDetection } from "@/api/review";
import { MapReviewPanel } from "./MapReviewPanel";

const det = (id: string, confidence = 0.9): MapDetection => ({
  id,
  class_id: CLASS_ID(1),
  confidence,
  x: 100,
  y: 200,
  w: 30,
  h: 20,
  angle: null,
  review_state: "unreviewed",
  provenance_kind: "local_model",
});

const RUN = { ...exampleMapRun, detection_count: 530 };

function Harness({ onChanged = () => {} }: { onChanged?: () => void }) {
  const [current, setCurrent] = useState<MapDetection | null>(null);
  const [drawing, setDrawing] = useState(false);
  return (
    <MapReviewPanel
      projectId={PROJECT_ID}
      run={RUN}
      classes={exampleClasses}
      current={current}
      onCurrent={setCurrent}
      drawing={drawing}
      onDrawing={setDrawing}
      drawClassId={CLASS_ID(1)}
      onDrawClass={() => {}}
      onChanged={onChanged}
    />
  );
}

function routes(remaining = 118) {
  let n = 0;
  return fakeClient([
    {
      method: "GET",
      path: /\/next-unreviewed$/,
      body: () => ({ detection: det(`d${++n}`), remaining: remaining - n + 1 }),
    },
    { method: "POST", path: /\/review$/, body: { updated: 1 } },
    {
      method: "POST",
      path: /\/accept-above$/,
      status: 202,
      body: { job: { ...runningJob, type: "accept_above" } },
    },
  ]);
}

describe("MapReviewPanel", () => {
  it("opens on the first unreviewed detection and shows the progress", async () => {
    const { api } = routes();
    renderWithProviders(<Harness />, { api });
    expect(await screen.findByText("412 of 530 reviewed")).toBeInTheDocument();
    expect(screen.getByTestId("review-current")).toHaveTextContent("excavator");
    expect(screen.getByTestId("review-current")).toHaveTextContent("90%");
  });

  it("sends accept, reject, reclass and next from the keyboard", async () => {
    const { api, requests } = routes();
    const onChanged = vi.fn();
    renderWithProviders(<Harness onChanged={onChanged} />, { api });
    await screen.findByText("412 of 530 reviewed");

    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/review"))).toHaveLength(1));
    await waitFor(() => expect(screen.getByTestId("review-current")).toHaveAttribute("data-id", "d2"));

    fireEvent.keyDown(window, { key: "R" });
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/review"))).toHaveLength(2));
    await waitFor(() => expect(screen.getByTestId("review-current")).toHaveAttribute("data-id", "d3"));

    fireEvent.keyDown(window, { key: "4" });
    await waitFor(() => expect(requests.filter((r) => r.url.endsWith("/review"))).toHaveLength(3));
    await waitFor(() => expect(screen.getByTestId("review-current")).toHaveAttribute("data-id", "d4"));

    fireEvent.keyDown(window, { key: "n" });
    await waitFor(() => expect(screen.getByTestId("review-current")).toHaveAttribute("data-id", "d5"));

    const bodies = requests.filter((r) => r.url.endsWith("/review")).map((r) => r.body);
    expect(bodies).toEqual([
      { detection_ids: ["d1"], action: "accept" },
      { detection_ids: ["d2"], action: "reject" },
      { detection_ids: ["d3"], action: "reclass", class_id: CLASS_ID(4) },
    ]);
    // Each decision moves on from the detection it decided; N skips without deciding.
    const walks = requests
      .filter((r) => r.url.includes("next-unreviewed"))
      .map((r) => r.url.split("?")[1] ?? "");
    expect(walks).toEqual(["", "after_id=d1", "after_id=d2", "after_id=d3", "after_id=d4"]);
    expect(onChanged).toHaveBeenCalledTimes(3);
  });

  it("ignores keys while typing and with a modifier", async () => {
    const { api, requests } = routes();
    renderWithProviders(<Harness />, { api });
    await screen.findByText("412 of 530 reviewed");
    const input = screen.getByLabelText("Minimum confidence");
    fireEvent.keyDown(input, { key: "a" });
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(requests.filter((r) => r.url.endsWith("/review"))).toHaveLength(0);
  });

  it("accepts everything at or above a confidence as a job", async () => {
    const { api, requests } = routes();
    renderWithProviders(<Harness />, { api });
    await screen.findByText("412 of 530 reviewed");
    fireEvent.change(screen.getByLabelText("Minimum confidence"), { target: { value: "0.9" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept all at or above" }));
    await waitFor(() =>
      expect(requests.find((r) => r.url.endsWith("/accept-above"))?.body).toEqual({ min_confidence: 0.9 }),
    );
  });

  it("toggles the draw tool", async () => {
    const { api } = routes();
    renderWithProviders(<Harness />, { api });
    await screen.findByText("412 of 530 reviewed");
    const draw = screen.getByRole("button", { name: "Draw missed object" });
    expect(draw).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(draw);
    expect(draw).toHaveAttribute("aria-pressed", "true");
  });

  it("says when nothing is left to review", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/next-unreviewed$/, body: { detection: null, remaining: 0 } },
    ]);
    renderWithProviders(<Harness />, { api });
    expect(await screen.findByText("530 of 530 reviewed")).toBeInTheDocument();
    expect(screen.getByText("Every detection in this run is reviewed.")).toBeInTheDocument();
  });
});
