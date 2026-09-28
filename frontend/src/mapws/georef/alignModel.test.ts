import { describe, expect, it } from "vitest";
import { ApiFailure } from "@/api/errors";
import { LOCAL } from "@/mapws/test/fixtures";
import { dxfDrawing, pdfDrawing, placedPdfDrawing, SITE_FRAME } from "@/mapws/drawings/testFixtures";
import type { SiteFrame } from "@/mapws/types";
import { applyAffine, MAX_PAIRS, type Affine } from "./fit";
import {
  clickAt,
  MISSED_DRAWING,
  overlayMarks,
  pointInQuad,
  provisionalTransform,
  quadOf,
  removePair,
  setModel,
  startSession,
  undoLast,
  type Extent4,
} from "./alignModel";
import { fitSummary, formatMetres, georefErrorText } from "./messages";
import { placementInFrame, sessionFor, viewportOf } from "./alignStore";

const SRC: Extent4 = [0, -3000, 4000, 0];
const VIEW: Extent4 = [500000, 4982000, 501000, 4983000];
const TRUE: Affine = [0.02, 0, 500010, 0, 0.02, 4982990];

/**
 * A genuinely different, internally consistent frame (fix round 1, controller ruling): unlike
 * `{...SITE_FRAME, epsg: 32639}`, this frame's `crs_wkt` and `epsg` actually agree with each other,
 * the way the server always produces them (`backend/app/workspace/frame.py` `frame_for_epsg` /
 * `frame_for_crs`).
 */
const OTHER_CRS_FRAME: SiteFrame = {
  kind: "crs",
  epsg: 32639,
  crs_wkt: 'PROJCRS["WGS 84 / UTM zone 39N",ID["EPSG",32639]]',
  name: "WGS 84 / UTM zone 39N",
  proj4: "+proj=utm +zone=39 +datum=WGS84 +units=m +no_defs",
};

function session() {
  return startSession({
    drawingId: "d",
    extentSrc: SRC,
    viewport: VIEW,
    saved: null,
    unitsScale: null,
  });
}
/** Click where `src` shows on the drawing now, then where it truly is on the map. */
function pick(s: ReturnType<typeof session>, src: [number, number]) {
  const first = clickAt(s, applyAffine(s.transform, src)).session;
  return clickAt(first, applyAffine(TRUE, src)).session;
}

describe("provisional placement (spec §8.3: 60% of the viewport, centred, north up)", () => {
  it("fits the drawing's extent to 60% of the view", () => {
    const t = provisionalTransform(SRC, VIEW);
    expect([t[1], t[3]]).toEqual([0, 0]);
    const q = quadOf(t, SRC);
    expect(q[1][0] - q[0][0]).toBeCloseTo(600, 6); // 0.6 × 1000 m, width-limited
    expect((q[0][0] + q[2][0]) / 2).toBeCloseTo(500500, 6);
    expect((q[0][1] + q[2][1]) / 2).toBeCloseTo(4982500, 6);
  });
});

describe("clicks", () => {
  it("records nothing when the first click misses the drawing", () => {
    const s = session();
    const r = clickAt(s, [500001, 4982001]);
    expect(r.session).toBe(s);
    expect(r.notice).toBe(MISSED_DRAWING);
  });

  it("pairs a drawing click with a map click; two pairs fit a similarity and move the preview", () => {
    let s = pick(session(), [100, -100]);
    expect(s.pairs).toHaveLength(1);
    expect(s.pairs[0].src[0]).toBeCloseTo(100, 6);
    expect(s.fit).toEqual({ ok: false, error: "too_few_points" });
    s = pick(s, [3900, -2900]);
    expect(s.fit?.ok).toBe(true);
    s.transform.forEach((v, i) => expect(v).toBeCloseTo(TRUE[i], 6));
    expect(s.pairs.map((p) => p.id)).toEqual(["cp1", "cp2"]);
  });

  it("keeps the last good placement when a fit is refused (mirrored order)", () => {
    let s = pick(pick(pick(setModel(session(), "affine"), [100, -100]), [3900, -100]), [100, -2900]);
    expect(s.fit?.ok).toBe(true);
    const good = s.transform;
    const mirrored = {
      ...s,
      pairs: s.pairs.map((p) => ({
        ...p,
        dst: [2 * 500050 - p.dst[0], p.dst[1]] as [number, number],
      })),
    };
    s = setModel(mirrored, "affine");
    expect(s.fit).toEqual({ ok: false, error: "reflection" });
    expect(s.transform).toBe(good);
  });

  it("undo clears a pending click first, then the last pair; removePair refits", () => {
    let s = pick(pick(session(), [100, -100]), [3900, -2900]);
    const pending = clickAt(s, applyAffine(s.transform, [2000, -1500])).session;
    expect(pending.pendingSrc).not.toBeNull();
    expect(undoLast(pending).pendingSrc).toBeNull();
    expect(undoLast(pending).pairs).toHaveLength(2);
    s = undoLast(s);
    expect(s.pairs).toHaveLength(1);
    expect(removePair(s, "cp1").pairs).toHaveLength(0);
  });

  it("refuses a 12th pair on the first (drawing) click, not the second (preflight adaptation 4)", () => {
    let s = session();
    for (let i = 0; i < MAX_PAIRS; i++) {
      s = pick(s, [100 + i * 10, -100 - i * 10]);
    }
    expect(s.pairs).toHaveLength(MAX_PAIRS);
    const r = clickAt(s, applyAffine(s.transform, [3000, -2000]));
    expect(r.session).toBe(s);
    expect(r.session.pendingSrc).toBeNull();
    expect(r.notice).toBe("At most 12 pairs: delete one to add another.");
  });
});

describe("pointInQuad", () => {
  it("handles a rotated parallelogram", () => {
    const t: Affine = [0.7, -0.7, 0, 0.7, 0.7, 0];
    const q = quadOf(t, [0, 0, 10, 10]);
    expect(pointInQuad(applyAffine(t, [5, 5]), q)).toBe(true);
    expect(pointInQuad([20, 20], q)).toBe(false);
  });
});

describe("overlay marks", () => {
  it("draws a residual line, a src and a dst bubble per pair, plus the pending click", () => {
    const s = pick(session(), [100, -100]);
    const pending = clickAt(s, applyAffine(s.transform, [2000, -1500])).session;
    expect(overlayMarks(pending).map((m) => `${m.kind}${m.n}`)).toEqual([
      "residual1",
      "src1",
      "dst1",
      "pending2",
    ]);
  });
});

describe("messages", () => {
  it("says 'Add a point to check the fit' at exactly the minimum", () => {
    const s = pick(pick(session(), [100, -100]), [3900, -2900]);
    expect(fitSummary("similarity", 2, s.fit)).toEqual({
      tone: "info",
      text: "Add a point to check the fit.",
    });
    expect(fitSummary("affine", 1, null)).toEqual({
      tone: "info",
      text: "Add 2 more pairs for an affine fit.",
    });
    expect(fitSummary("affine", 3, { ok: false, error: "reflection" }).tone).toBe("danger");
    expect(
      fitSummary("similarity", 3, {
        ok: true,
        transform: TRUE,
        scale: 0.02,
        rotation_deg: 0,
        rmse_m: 0.3,
        residuals_m: [],
        warnings: ["rmse_high"],
      }),
    ).toEqual({ tone: "warn", text: "RMSE 30.0 cm" });
  });

  it("formats metres and reads a server refusal", () => {
    expect(formatMetres(0.064)).toBe("6.4 cm");
    expect(formatMetres(1.5)).toBe("1.50 m");
    // Preflight adaptation #1: ApiFailure's ctor is (code, message, status, details?).
    const err = new ApiFailure("reflection", "x", 422);
    expect(georefErrorText(err)).toMatch(/mirrored order/);
  });
});

describe("sessions and the frame (R-W5-5)", () => {
  it("knows a placement's frame from its WKT or EPSG", () => {
    expect(placementInFrame(placedPdfDrawing.georef!, SITE_FRAME)).toBe(true);
    expect(placementInFrame(placedPdfDrawing.georef!, OTHER_CRS_FRAME)).toBe(false);
    expect(placementInFrame(dxfDrawing.georef!, SITE_FRAME)).toBe(true);
    // Preflight adaptation #2: the local-frame literal uses fixtures.ts's LOCAL (SiteFrame requires crs_wkt).
    expect(placementInFrame({ ...placedPdfDrawing.georef!, dst_crs_wkt: null }, LOCAL)).toBe(true);
  });

  it("matches by WKT identity even when the frame's EPSG is set but its WKT has no ID/AUTHORITY tag (fix round 1 (c))", () => {
    // frame_for_crs (backend/app/workspace/frame.py) can produce exactly this: epsg set from a
    // pyproj match, crs_wkt with no parseable EPSG tag. The drawing's dst_crs_wkt is that same
    // string, so the match must not depend on epsgOfWkt succeeding.
    const untaggedFrame: SiteFrame = {
      kind: "crs",
      epsg: 32638,
      crs_wkt: 'PROJCRS["Custom local CRS, no ID tag"]',
      name: "Custom",
      proj4: "+proj=utm +zone=38 +datum=WGS84 +units=m +no_defs",
    };
    const g = { ...placedPdfDrawing.georef!, dst_crs_wkt: untaggedFrame.crs_wkt };
    expect(placementInFrame(g, untaggedFrame)).toBe(true);
  });
  it("resumes the saved control points in the same frame", () => {
    const r = sessionFor(placedPdfDrawing, VIEW, SITE_FRAME);
    expect(r.session.pairs.map((p) => p.id)).toEqual(["cp1", "cp2", "cp3"]);
    expect(r.session.nextId).toBe(4);
    expect(r.notice).toBeNull();
  });
  it("starts afresh, with a notice, when placed in another CRS", () => {
    const r = sessionFor(placedPdfDrawing, VIEW, OTHER_CRS_FRAME);
    expect(r.session.pairs).toHaveLength(0);
    expect(r.notice).toMatch(/placed in another CRS/);
  });
  it("places an unplaced drawing provisionally", () => {
    expect(sessionFor(pdfDrawing, VIEW, SITE_FRAME).session.start).toEqual(
      provisionalTransform(pdfDrawing.extent_src as Extent4, VIEW),
    );
  });
});

describe("viewportOf (controller ruling PF17: no OL map — Task 9's Overlay has none)", () => {
  it("is the view's centre ± resolution·size/2, ignoring rotation", () => {
    const e = viewportOf({ center: [500000, 4982500], resolution: 2, rotation: 1 }, [800, 600]);
    expect(e).toEqual([499200, 4981900, 500800, 4983100]);
  });
});
