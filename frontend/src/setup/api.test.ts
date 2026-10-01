import { describe, expect, it } from "vitest";
import { ApiFailure } from "@/api/errors";
import { fakeClient, runningJob } from "@/test/fixtures";
import {
  INSPECT_JOB_ID,
  SAVED,
  TEMPLATES,
  VISUAL,
  doneInspectJob,
  inspectJob,
  inspectResult,
  typeSpec,
} from "@/test/setupFixtures";
import {
  createTemplate,
  deleteTemplate,
  ensureTypes,
  inspectResultOf,
  isTemplateBuiltin,
  isTemplateNameTaken,
  listTemplates,
  patchTemplate,
  readInspectJob,
  startInspect,
} from "./api";

describe("setup api", () => {
  it("lists the templates in the server's order", async () => {
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/project-templates$/, body: { items: TEMPLATES } },
    ]);
    expect((await listTemplates(api)).map((t) => t.id)).toEqual([
      "builtin-mapping",
      "builtin-vertical",
      "builtin-confined",
      "tpl-saved-1",
    ]);
    expect(requests[0]).toMatchObject({ method: "GET", url: "/api/v1/project-templates" });
  });

  it("creates, renames and deletes a user template", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/project-templates$/, status: 201, body: SAVED },
      { method: "PATCH", path: /\/project-templates\/[^/]+$/, body: { ...SAVED, name: "Mast X" } },
      { method: "DELETE", path: /\/project-templates\/[^/]+$/, status: 204 },
    ]);
    const body = { name: SAVED.name, config: SAVED.config };
    expect(await createTemplate(api, body)).toEqual(SAVED);
    expect((await patchTemplate(api, SAVED.id, { name: "Mast X" })).name).toBe("Mast X");
    await deleteTemplate(api, SAVED.id);
    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "POST /api/v1/project-templates",
      "PATCH /api/v1/project-templates/tpl-saved-1",
      "DELETE /api/v1/project-templates/tpl-saved-1",
    ]);
    expect(requests[0].body).toEqual(body);
    expect(requests[1].body).toEqual({ name: "Mast X" });
  });

  it("sends ensure with the specs and the dry-run flag", async () => {
    const items = [{ name: "Rust", id: null, created: false, conflict: null }];
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/catalogue\/types\/ensure$/, body: { items } },
    ]);
    const types = [typeSpec("Rust", "defect", 2, "1")];
    expect((await ensureTypes(api, { types, dry_run: true })).items).toEqual(items);
    expect(requests[0].body).toEqual({ types, dry_run: true });
  });

  it("starts a sort on the library and returns its job", async () => {
    const { api, requests } = fakeClient([
      { method: "POST", path: /\/setup\/inspect$/, status: 202, body: { job: inspectJob() } },
    ]);
    const job = await startInspect(api, { paths: ["E:\\DCIM"], template_id: "builtin-vertical" });
    expect(job.id).toBe(INSPECT_JOB_ID);
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "/api/v1/setup/inspect",
      body: { paths: ["E:\\DCIM"], template_id: "builtin-vertical" },
    });
  });

  it("reads the sort through the library jobs route and casts its result", async () => {
    const result = inspectResult([VISUAL]);
    const { api, requests } = fakeClient([
      { method: "GET", path: /\/library\/jobs\/[^/]+$/, body: doneInspectJob(result) },
    ]);
    const read = await readInspectJob(api, INSPECT_JOB_ID);
    expect(requests[0].url).toBe(`/api/v1/library/jobs/${INSPECT_JOB_ID}`);
    expect(read.result).toEqual(result);
  });

  it("reads a result only from a finished setup_inspect job", () => {
    const result = inspectResult([VISUAL]);
    expect(inspectResultOf(inspectJob())).toBeNull();
    expect(inspectResultOf({ ...doneInspectJob(result), type: "import" })).toBeNull();
    expect(inspectResultOf(doneInspectJob(result, { result: { buckets: "nope" } }))).toBeNull();
    expect(inspectResultOf({ ...runningJob, state: "succeeded" })).toBeNull();
    expect(inspectResultOf(doneInspectJob(result))).toEqual(result);
  });

  it("names the template refusals", () => {
    expect(isTemplateNameTaken(new ApiFailure("template_name_taken", "taken", 409))).toBe(true);
    expect(isTemplateBuiltin(new ApiFailure("template_builtin", "read-only", 409))).toBe(true);
    expect(isTemplateNameTaken(new ApiFailure("invalid_template", "bad", 422))).toBe(false);
  });
});
