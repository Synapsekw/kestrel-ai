import { describe, expect, it } from "vitest";
import { IMAGE_ID, MAP_ID } from "@/test/fixtures";
import { canOpen, cardState, coverUrl, dataChips, visibleProjects } from "./projectCards";
import {
  failedProject,
  missingProject,
  okProject,
  pendingProject,
  upgradingProject,
} from "./projectFixtures";

const all = [okProject, upgradingProject, failedProject, pendingProject];

describe("visibleProjects", () => {
  it("keeps the server's last-opened order by default and searches names", () => {
    expect(visibleProjects(all, "", "recent").map((p) => p.id)).toEqual(["p-ok", "p-up", "p-bad", "p-wait"]);
    expect(visibleProjects(all, "  bridge ", "recent").map((p) => p.id)).toEqual(["p-up"]);
  });

  it("sorts by name and by open findings", () => {
    expect(visibleProjects(all, "", "name").map((p) => p.name)).toEqual([
      "Ahmadia Tower",
      "Bridge B2",
      "Quarry",
      "Yard 7",
    ]);
    expect(visibleProjects(all, "", "findings").map((p) => p.id)).toEqual([
      "p-ok",
      "p-wait",
      "p-up",
      "p-bad",
    ]);
  });
});

describe("cardState", () => {
  it("maps the migration state", () => {
    expect(cardState(okProject)).toEqual({ kind: "ok" });
    expect(cardState(upgradingProject)).toEqual({ kind: "upgrading", jobId: "j-migrate" });
    expect(cardState(pendingProject)).toEqual({ kind: "pending" });
    expect(cardState(failedProject)).toEqual({
      kind: "failed",
      error: "step rewrite_class_ids: database disk image is malformed",
      backupPath: failedProject.migration.backup_path,
    });
    expect(all.filter(canOpen).map((p) => p.id)).toEqual(["p-ok"]);
  });

  it("a project whose folder is gone is missing and cannot open, whatever its migration says", () => {
    expect(cardState(missingProject)).toEqual({ kind: "missing" });
    expect(canOpen(missingProject)).toBe(false);
    expect(coverUrl(missingProject, "http://h", "t")).toBeNull();
  });

  it("a failed project with no summary still has chips and no cover", () => {
    expect(dataChips(failedProject.summary)).toEqual([]);
    expect(coverUrl(failedProject, "http://h", "t")).toBeNull();
  });
});

describe("chips and covers", () => {
  it("lists non-zero data", () => {
    expect(dataChips(okProject.summary)).toEqual(["1,284 images", "3 maps", "2 clouds", "1 elevation"]);
    expect(
      dataChips({ ...okProject.summary!, maps: 1, point_clouds: 0, elevations: 0, image_count: 1 }),
    ).toEqual(["1 image", "1 map"]);
  });

  it("uses the hero map's preview, else the newest image thumbnail", () => {
    expect(coverUrl(okProject, "http://h", "t")).toBe(
      `http://h/api/v1/projects/p-ok/maps/${MAP_ID}/preview?token=t`,
    );
    expect(coverUrl(upgradingProject, "http://h", "t")).toBe(
      `http://h/api/v1/projects/p-up/images/${IMAGE_ID}/thumbnail?token=t`,
    );
  });
});
