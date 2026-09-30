import { describe, expect, it } from "vitest";
import { fakeClient } from "@/test/fixtures";
import {
  canonicalJson,
  createReport,
  createTemplate,
  deleteReport,
  deleteTemplate,
  deleteVersion,
  draftBlocksLoader,
  duplicateReport,
  getOutline,
  getReport,
  getTemplate,
  getVersion,
  getVersionDocumentPage,
  importReportAsset,
  listReports,
  listSectionBlocks,
  listTemplates,
  listVersions,
  openProjectFile,
  patchReport,
  patchTemplate,
  reportAssetUrl,
  setVersionIssued,
  snapshotUrl,
  specParam,
  startRender,
  versionBlocksLoader,
  type Block,
  type ReportDocumentPage,
  type SnapshotRef,
  type TemplateCreate,
  type TemplatePatch,
} from "./reports";

const PAGE = { items: [], next_cursor: null };
const DOC_PAGE: ReportDocumentPage = {
  report_id: "r1",
  version: 2,
  generated_at: "2026-09-29T00:00:00Z",
  theme_version: "v1",
  sections: [{ key: "summary", title: "Summary", blocks: [] }],
  next_cursor: null,
};

function client() {
  return fakeClient([
    { method: "GET", path: /\/reports$/, body: PAGE },
    { method: "POST", path: /\/reports$/, status: 201, body: {} },
    { method: "GET", path: /\/reports\/r1$/, body: {} },
    { method: "PATCH", path: /\/reports\/r1$/, body: {} },
    { method: "DELETE", path: /\/reports\/r1$/, status: 204 },
    { method: "POST", path: /\/reports\/r1\/duplicate$/, status: 201, body: {} },
    { method: "GET", path: /\/reports\/r1\/outline$/, body: {} },
    { method: "GET", path: /\/reports\/r1\/sections\/summary\/blocks$/, body: PAGE },
    { method: "POST", path: /\/reports\/r1\/renders$/, status: 202, body: { job: {} } },
    { method: "GET", path: /\/reports\/r1\/versions$/, body: PAGE },
    { method: "GET", path: /\/reports\/r1\/versions\/2$/, body: {} },
    { method: "PATCH", path: /\/reports\/r1\/versions\/2$/, body: {} },
    { method: "DELETE", path: /\/reports\/r1\/versions\/2$/, status: 204 },
    { method: "GET", path: /\/reports\/r1\/versions\/2\/document$/, body: DOC_PAGE },
    { method: "POST", path: /\/p1\/open$/, status: 204 },
    { method: "POST", path: /\/report-assets$/, status: 201, body: {} },
    { method: "GET", path: /\/report-templates$/, body: PAGE },
    { method: "POST", path: /\/report-templates$/, status: 201, body: {} },
    { method: "GET", path: /\/report-templates\/t1$/, body: {} },
    { method: "PATCH", path: /\/report-templates\/t1$/, body: {} },
    { method: "DELETE", path: /\/report-templates\/t1$/, status: 204 },
  ]);
}

describe("reports requests", () => {
  it("calls every §14 endpoint with its path, query and body", async () => {
    const { api, requests } = client();
    await listReports(api, "p1");
    await listReports(api, "p1", "c2");
    await createReport(api, "p1", { title: "Q3 inspection", template_id: "builtin-full" });
    await getReport(api, "p1", "r1");
    await patchReport(api, "p1", "r1", { title: "Renamed" });
    await deleteReport(api, "p1", "r1");
    await duplicateReport(api, "p1", "r1");
    await getOutline(api, "p1", "r1");
    await listSectionBlocks(api, "p1", "r1", "summary", null);
    await listSectionBlocks(api, "p1", "r1", "summary", "c50");
    await startRender(api, "p1", "r1", { formats: ["pdf", "xlsx"] });
    await listVersions(api, "p1", "r1");
    await getVersion(api, "p1", "r1", 2);
    await setVersionIssued(api, "p1", "r1", 2, true);
    await deleteVersion(api, "p1", "r1", 2);
    await getVersionDocumentPage(api, "p1", "r1", 2, null);
    await openProjectFile(api, "p1", "reports/r1/v2/report.pdf");
    await importReportAsset(api, "p1", "C:/logos/acme.png");
    await listTemplates(api);
    await createTemplate(api, { name: "Mine", description: "", config: {} } as unknown as TemplateCreate);
    await getTemplate(api, "t1");
    await patchTemplate(api, "t1", { name: "Ours" } as unknown as TemplatePatch);
    await deleteTemplate(api, "t1");

    expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
      "GET /api/v1/projects/p1/reports?limit=50",
      "GET /api/v1/projects/p1/reports?limit=50&cursor=c2",
      "POST /api/v1/projects/p1/reports",
      "GET /api/v1/projects/p1/reports/r1",
      "PATCH /api/v1/projects/p1/reports/r1",
      "DELETE /api/v1/projects/p1/reports/r1",
      "POST /api/v1/projects/p1/reports/r1/duplicate",
      "GET /api/v1/projects/p1/reports/r1/outline",
      "GET /api/v1/projects/p1/reports/r1/sections/summary/blocks?limit=50",
      "GET /api/v1/projects/p1/reports/r1/sections/summary/blocks?limit=50&cursor=c50",
      "POST /api/v1/projects/p1/reports/r1/renders",
      "GET /api/v1/projects/p1/reports/r1/versions?limit=50",
      "GET /api/v1/projects/p1/reports/r1/versions/2",
      "PATCH /api/v1/projects/p1/reports/r1/versions/2",
      "DELETE /api/v1/projects/p1/reports/r1/versions/2",
      "GET /api/v1/projects/p1/reports/r1/versions/2/document?limit=50",
      "POST /api/v1/projects/p1/open",
      "POST /api/v1/projects/p1/report-assets",
      "GET /api/v1/report-templates?limit=50",
      "POST /api/v1/report-templates",
      "GET /api/v1/report-templates/t1",
      "PATCH /api/v1/report-templates/t1",
      "DELETE /api/v1/report-templates/t1",
    ]);
    const body = (i: number) => requests[i].body;
    expect(body(2)).toEqual({ title: "Q3 inspection", template_id: "builtin-full" });
    expect(body(4)).toEqual({ title: "Renamed" });
    expect(body(10)).toEqual({ formats: ["pdf", "xlsx"] });
    expect(body(13)).toEqual({ issued: true });
    expect(body(16)).toEqual({ path: "reports/r1/v2/report.pdf" });
    expect(body(17)).toEqual({ path: "C:/logos/acme.png" });
  });

  it("builds block loaders for the draft and for a frozen version", async () => {
    const { api, requests } = client();
    await draftBlocksLoader(api, "p1", "r1")("summary", "c50");
    await versionBlocksLoader(api, "p1", "r1", 2)("summary", null);
    expect(requests.map((r) => r.url)).toEqual([
      "/api/v1/projects/p1/reports/r1/sections/summary/blocks?limit=50&cursor=c50",
      "/api/v1/projects/p1/reports/r1/versions/2/document?limit=50",
    ]);
  });

  it("sends include_archived only when given (Ruling R-2)", async () => {
    const { api: apiOmitted, requests: omitted } = client();
    await listReports(apiOmitted, "p1");
    await listReports(apiOmitted, "p1", undefined, {});
    expect(omitted.map((r) => r.url)).toEqual([
      "/api/v1/projects/p1/reports?limit=50",
      "/api/v1/projects/p1/reports?limit=50",
    ]);

    const { api: apiTrue, requests: trueReq } = client();
    await listReports(apiTrue, "p1", undefined, { includeArchived: true });
    expect(trueReq.map((r) => r.url)).toEqual(["/api/v1/projects/p1/reports?limit=50&include_archived=true"]);

    const { api: apiFalse, requests: falseReq } = client();
    await listReports(apiFalse, "p1", undefined, { includeArchived: false });
    expect(falseReq.map((r) => r.url)).toEqual(["/api/v1/projects/p1/reports?limit=50&include_archived=false"]);
  });
});

describe("versionBlocksLoader pagination (Ruling R-3)", () => {
  const PAGE_1: ReportDocumentPage = {
    report_id: "r1",
    version: 2,
    generated_at: "2026-09-29T00:00:00Z",
    theme_version: "v1",
    sections: [
      { key: "summary", title: "Summary", blocks: [{ kind: "para", text: "Part one.", style: "body" } as Block] },
    ],
    next_cursor: "p2",
  };
  const PAGE_2: ReportDocumentPage = {
    report_id: "r1",
    version: 2,
    generated_at: "2026-09-29T00:00:00Z",
    theme_version: "v1",
    sections: [
      { key: "summary", title: "Summary", blocks: [{ kind: "para", text: "Part two.", style: "body" } as Block] },
      {
        key: "appendix",
        title: "Appendix",
        blocks: [{ kind: "para", text: "Appendix text.", style: "body" } as Block],
      },
    ],
    next_cursor: null,
  };

  function twoPageClient() {
    return fakeClient([
      {
        method: "GET",
        path: /\/versions\/2\/document$/,
        body: (req) => (req.url.includes("cursor=p2") ? PAGE_2 : PAGE_1),
      },
    ]);
  }

  it("returns a section's run on the page it starts, and continues from the page cursor", async () => {
    const { api, requests } = twoPageClient();
    const loadBlocks = versionBlocksLoader(api, "p1", "r1", 2);

    const first = await loadBlocks("summary", null);
    expect(first).toEqual({ items: PAGE_1.sections[0].blocks, next_cursor: "p2" });

    const second = await loadBlocks("summary", "p2");
    expect(second).toEqual({ items: PAGE_2.sections[0].blocks, next_cursor: null });

    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.url)).toEqual([
      "/api/v1/projects/p1/reports/r1/versions/2/document?limit=50",
      "/api/v1/projects/p1/reports/r1/versions/2/document?limit=50&cursor=p2",
    ]);

    // a repeat request for the same document cursor reuses the memo
    const again = await loadBlocks("summary", null);
    expect(again).toEqual(first);
    expect(requests).toHaveLength(2);
  });

  it("fetches each page once even when a later section is requested before an earlier one", async () => {
    const { api, requests } = twoPageClient();
    const loadBlocks = versionBlocksLoader(api, "p1", "r1", 2);

    const appendix = await loadBlocks("appendix", null);
    expect(appendix).toEqual({ items: PAGE_2.sections[1].blocks, next_cursor: null });

    const summary = await loadBlocks("summary", null);
    expect(summary).toEqual({ items: PAGE_1.sections[0].blocks, next_cursor: "p2" });

    expect(requests).toHaveLength(2);
    expect(requests.map((r) => r.url)).toEqual([
      "/api/v1/projects/p1/reports/r1/versions/2/document?limit=50",
      "/api/v1/projects/p1/reports/r1/versions/2/document?limit=50&cursor=p2",
    ]);
  });

  it("returns an empty page when the key is never found", async () => {
    const { api } = fakeClient([
      { method: "GET", path: /\/versions\/2\/document$/, body: { ...PAGE_1, next_cursor: null } },
    ]);
    const loadBlocks = versionBlocksLoader(api, "p1", "r1", 2);
    expect(await loadBlocks("appendix", null)).toEqual({ items: [], next_cursor: null });
  });
});

const decode = (param: string): string => {
  const b64 = param.replace(/-/g, "+").replace(/_/g, "/");
  return atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
};

describe("canonical snapshot spec", () => {
  it("sorts keys at every depth and uses compact separators", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[{"y":2,"z":1}]},"b":1}',
    );
  });

  it("escapes non-ASCII like Python's ensure_ascii, lowercase hex", () => {
    expect(canonicalJson({ label: "Kran č" })).toBe('{"label":"Kran \\u010d"}');
    expect(canonicalJson({ label: "é\u{1F600}" })).toBe('{"label":"\\u00e9\\ud83d\\ude00"}');
    expect(canonicalJson({ label: 'q"\n' })).toBe('{"label":"q\\"\\n"}');
  });

  it("drops undefined keys and keeps null, booleans and numbers", () => {
    expect(canonicalJson({ a: undefined, b: null, c: true, d: 1.5, e: [1, "x"] })).toBe(
      '{"b":null,"c":true,"d":1.5,"e":[1,"x"]}',
    );
  });

  it("writes integral numbers without a fraction, and -0 as 0 (Ruling R-4)", () => {
    expect(canonicalJson({ a: 3.0, b: -0 })).toBe('{"a":3,"b":0}');
  });

  it("refuses non-finite numbers", () => {
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it("encodes the spec as unpadded base64url of the canonical JSON", () => {
    const spec = { kind: "image_crop", label: "Riß ?>", out: [1200, 900] };
    const param = specParam(spec as unknown as SnapshotRef["spec"]);
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(param)).toBe(canonicalJson(spec));
  });

  it("builds the snapshot URL, with the token only when a backend is given", () => {
    const ref = { key: "abc123", spec: { kind: "volume_plan", measurement_id: "m1" } } as unknown as SnapshotRef;
    const param = specParam(ref.spec);
    expect(snapshotUrl("p1", ref)).toBe(`/api/v1/projects/p1/report-snapshots/abc123?spec=${param}`);
    expect(snapshotUrl("p1", ref, { baseUrl: "http://127.0.0.1:8765/", token: "t k" })).toBe(
      `http://127.0.0.1:8765/api/v1/projects/p1/report-snapshots/abc123?spec=${param}&token=t+k`,
    );
  });

  it("encodeURIComponent's the project id and the snapshot key", () => {
    const ref = { key: "a/b c", spec: { kind: "volume_plan", measurement_id: "m1" } } as unknown as SnapshotRef;
    const param = specParam(ref.spec);
    expect(snapshotUrl("p/1", ref)).toBe(
      `/api/v1/projects/${encodeURIComponent("p/1")}/report-snapshots/${encodeURIComponent("a/b c")}?spec=${param}`,
    );
  });
});

describe("reportAssetUrl (Ruling R-5)", () => {
  it("returns the origin-less path without a backend, and the full URL with a token with one", () => {
    expect(reportAssetUrl("p1", "asset1")).toBe("/api/v1/projects/p1/report-assets/asset1");
    expect(reportAssetUrl("p1", "asset1", { baseUrl: "http://127.0.0.1:8765/", token: "t k" })).toBe(
      "http://127.0.0.1:8765/api/v1/projects/p1/report-assets/asset1?token=t+k",
    );
  });

  it("encodeURIComponent's the project id and the asset id", () => {
    expect(reportAssetUrl("p/1", "a b")).toBe(
      `/api/v1/projects/${encodeURIComponent("p/1")}/report-assets/${encodeURIComponent("a b")}`,
    );
  });
});
