import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AssetModelRun } from "@contract/client";
import { renderWithProviders } from "@/test/render";
import { fakeClient } from "@/test/fixtures";
import { RUN } from "@/test/assetModelFixtures";
import { PACKAGES, plantModel } from "@/test/plantFixtures";
import { RunBar, costText, currentStage, packagesText, stageLabel } from "./RunBar";

const running: AssetModelRun = {
  ...RUN,
  id: "r1",
  mode: "plant",
  state: "running",
  phase: "reading",
  usage: { input_tokens: 1_400_000, output_tokens: 100_000 },
  packages: { total: 3, done: 1, failed: 0, running: 1 },
  usage_by_stage: {
    current: "trace",
    stages: {
      survey: { input_tokens: 300_000, output_tokens: 20_000, images: 12, calls: 30 },
      trace: { input_tokens: 1_100_000, output_tokens: 80_000, images: 40, calls: 90 },
    },
    cost_estimate_usd: 7.25,
    cost_label: "Estimated cost",
  },
};
function setup(model = plantModel({ live_run_id: "r1" })) {
  const client = fakeClient([
    { method: "GET", path: /\/asset-models\/m1\/runs\/r1$/, body: running },
    { method: "GET", path: /\/asset-models\/m1\/runs\/r1\/packages$/, body: { items: PACKAGES } },
    {
      method: "POST",
      path: /\/asset-models\/m1\/runs\/r1\/stop$/,
      status: 202,
      body: { ...running, state: "stopped", stop_reason: "user" },
    },
  ] as never);
  renderWithProviders(<RunBar projectId="p" model={model} />, { api: client.api });
  return client;
}

describe("RunBar", () => {
  it("shows the stage, the package count, the tokens, the cost estimate and the packages", async () => {
    setup();
    const bar = await screen.findByRole("region", { name: "Run" });
    expect(bar).toHaveTextContent("Tracing packages");
    expect(bar).toHaveTextContent("1 of 3 packages · 1 running");
    expect(bar).toHaveTextContent("1.5 M tokens");
    expect(bar).toHaveTextContent("Estimated cost $7.25");
    fireEvent.click(await screen.findByRole("button", { name: /packages/i }));
    expect(await screen.findByText("Tank row north")).toBeInTheDocument();
  });

  it("Stop stops the run and the bar goes", async () => {
    const { requests } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(requests.some((r) => r.method === "POST" && r.url.endsWith("/runs/r1/stop"))).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole("region", { name: "Run" })).toBeNull());
  });

  it("no live run, no bar", () => {
    setup(plantModel({ live_run_id: null }));
    expect(screen.queryByRole("region", { name: "Run" })).toBeNull();
  });

  it("names every stage in plain words, unknown ones by their name", () => {
    expect(stageLabel("survey")).toBe("Reading the drawings");
    expect(stageLabel("cloud_check")).toBe("Checking against the scan");
    expect(stageLabel("review")).toBe("Reviewing the scan check");
    expect(stageLabel("done")).toBe("Done");
    expect(stageLabel("finish")).toBe("Finishing");
    expect(stageLabel("building")).toBe("Building");
    expect(stageLabel("something_new")).toBe("Something new");
    expect(packagesText({ total: 4, done: 2, failed: 1, running: 0 })).toBe("2 of 4 packages · 1 failed");
  });

  it("the stage comes from usage_by_stage, else M1's phase; no estimate, no cost", () => {
    expect(currentStage(running)).toBe("trace");
    expect(currentStage({ ...RUN, phase: "building" })).toBe("building");
    expect(costText(running)).toBe("Estimated cost $7.25");
    expect(
      costText({ ...running, usage_by_stage: { ...running.usage_by_stage!, cost_estimate_usd: null } }),
    ).toBeNull();
    expect(costText(RUN)).toBeNull();
  });
});
