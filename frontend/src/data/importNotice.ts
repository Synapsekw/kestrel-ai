import type { Job } from "@contract/client";

export interface Notice {
  tone: "info" | "ok" | "warn" | "error";
  text: string;
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the Data Manager says about the import it started, from the job as the store knows it. */
export function importNotice(job: Job, folder: string): Notice {
  if (job.state === "queued" || job.state === "running")
    return { tone: "info", text: `Importing ${folder}… ${job.message ?? ""}`.trim() };
  if (job.state === "failed")
    return { tone: "error", text: `Import failed: ${job.error ?? "see the job log"}` };
  if (job.state === "cancelled")
    return {
      tone: "warn",
      text: "Import cancelled. Images prepared so far are kept; start it again to continue.",
    };
  const r = (job.result ?? {}) as {
    imported?: number;
    duplicates?: number;
    failed?: number;
    skipped?: number;
  };
  const imported = r.imported ?? 0;
  const duplicates = r.duplicates ?? 0;
  const failed = r.failed ?? 0;
  const skipped = r.skipped ?? 0;
  if (imported + duplicates + failed + skipped === 0)
    return { tone: "warn", text: "Import finished: no image files were found in that folder." };
  const parts = [`${count(imported, "image", "images")} added`];
  if (duplicates) parts.push(`${count(duplicates, "duplicate", "duplicates")} left out`);
  if (skipped) parts.push(`${skipped} already imported`);
  if (failed) parts.push(`${count(failed, "file", "files")} could not be read (see the job log)`);
  return { tone: failed ? "warn" : "ok", text: `Import finished: ${parts.join(", ")}.` };
}
