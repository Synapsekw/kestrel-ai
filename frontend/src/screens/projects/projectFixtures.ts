import type { Project } from "@contract/client";
import { exampleProject, IMAGE_ID, MAP_ID } from "@/test/fixtures";

export const okProject: Project = {
  ...exampleProject,
  id: "p-ok",
  name: "Ahmadia Tower",
  folder: "E:\\Projects\\Ahmadia-Tower",
  summary: {
    image_count: 1284,
    maps: 3,
    point_clouds: 2,
    elevations: 1,
    open_findings: 47,
    open_top_severity: 5,
    cover: { kind: "map", id: MAP_ID },
  },
  migration: { state: "ok" },
  last_opened_at: "2026-09-26T08:00:00Z",
};

export const upgradingProject: Project = {
  ...okProject,
  id: "p-up",
  name: "Bridge B2",
  folder: "E:\\Projects\\Bridge-B2",
  summary: {
    ...okProject.summary!,
    open_findings: 3,
    open_top_severity: 0,
    cover: { kind: "image", id: IMAGE_ID },
  },
  migration: { state: "running", job_id: "j-migrate" },
};

export const failedProject: Project = {
  ...okProject,
  id: "p-bad",
  name: "Yard 7",
  folder: "E:\\Projects\\Yard-7",
  summary: null,
  migration: {
    state: "failed",
    error: "step rewrite_class_ids: database disk image is malformed",
    backup_path: "E:\\Projects\\Yard-7\\backups\\project.db.v1-20260926T080000Z.bak",
  },
  last_opened_at: null,
};

export const pendingProject: Project = {
  ...okProject,
  id: "p-wait",
  name: "Quarry",
  folder: "E:\\Projects\\Quarry",
  migration: { state: "pending" },
};

/** A recent project whose folder was moved or deleted (operator decision 2026-09-26: listed, not hidden). */
export const missingProject: Project = {
  ...okProject,
  id: "p-gone",
  name: "Yard 9",
  folder: "E:\\Projects\\Yard-9",
  summary: null,
  migration: { state: "ok" },
  availability: "missing",
};
