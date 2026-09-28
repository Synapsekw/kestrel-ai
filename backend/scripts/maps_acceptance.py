"""Map-workspace acceptance over HTTP (spec 2026-09-26-map-workspace section 15 "Acceptance"),
against a running backend (APP_TOKEN/APP_PORT, APP_DATA_DIR in a scratch folder). Every step goes
through the API the workspace calls; imports and volumes are jobs, polled here. Request and
response shapes follow contract/openapi.yaml (the M-X Task 1 field map).

A step that fails is recorded in the output (`error`, `pass: false`) and the run goes on with the
steps that do not depend on it; the raw JSON is always written.

Usage:
  python scripts/maps_acceptance.py --base http://127.0.0.1:<port> --token <t> \
      --manifest <dir>/manifest.json --project-folder <scratch>/project --out <raw.json>
"""

from __future__ import annotations

import argparse
import json
import math
import re
import statistics
import sys
import time
from pathlib import Path

import httpx

RES0 = 1024.0  # app/workspace/grid.py: res(z) = 1024 / 2**z m/px, 256 px tiles
VOLUME_TOLERANCE = 0.02  # toe_plane against the analytic cone


# A Windows absolute path, raw or JSON-escaped (C:\\x, C:\x, C:/x), up to a quote, space or comma.
_PATH = re.compile(r"[A-Za-z]:(?:\\\\|\\|/)[^\s\"',]*")


class StepFailed(Exception):
    pass


def redact(text: str) -> str:
    """Error text goes into the evidence JSON: no operator or scratch path in it."""
    return _PATH.sub("<path>", text)


def imports_pass(m: dict, maps: dict, surfaces: dict) -> bool:
    """Every manifest ortho and DSM registered, and at least one of each."""
    return 0 < len(maps) == len(m["orthos"]) and 0 < len(surfaces) == len(m["dsms"])


def layers_pass(layers: list[dict], expected: int) -> bool:
    """One layer per import, at least one, all in the site frame."""
    return 0 < len(layers) == expected and all(la["in_frame"] for la in layers)


def check(r: httpx.Response, *codes: int) -> dict:
    if r.status_code not in (codes or (200, 201, 202)):
        text = f"{r.request.method} {r.request.url.path} -> {r.status_code}: {r.text[:400]}"
        raise StepFailed(redact(text))
    return r.json() if r.content else {}


def split(body: dict) -> tuple[dict, str | None]:
    """(entity, job id) of a `{<entity>, job}` creation response (map, surface, inspection,
    drawing, measurement)."""
    job = body.get("job")
    entity = next((v for k, v in body.items() if k != "job" and isinstance(v, dict)), body)
    return entity, (job or {}).get("id")


def wait(c: httpx.Client, pid: str, jid: str | None, timeout: float = 1800) -> dict:
    if jid is None:
        return {}
    t0 = time.time()
    while time.time() - t0 < timeout:
        job = check(c.get(f"/projects/{pid}/jobs/{jid}"))
        if job["state"] in ("succeeded", "failed", "cancelled"):
            if job["state"] != "succeeded":
                raise StepFailed(redact(f"job {jid} {job['state']}: {job.get('error')}"))
            return job
        time.sleep(0.5)
    raise StepFailed(f"job {jid} timed out")


def seg_dist(p, a, b) -> float:
    (px, py), (ax, ay), (bx, by) = p, a, b
    dx, dy = bx - ax, by - ay
    t = 0.0 if dx == dy == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def run_step(raw: dict, name: str, fn) -> object:
    try:
        return fn()
    except (StepFailed, httpx.HTTPError, KeyError, TypeError, ValueError) as e:
        raw["steps"][name] = {"pass": False, "error": redact(f"{type(e).__name__}: {e}")}
        return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--token", required=True)
    ap.add_argument("--manifest", required=True, type=Path)
    ap.add_argument("--project-folder", required=True)
    ap.add_argument("--out", required=True, type=Path)
    a = ap.parse_args()
    m = json.loads(a.manifest.read_text())
    raw: dict = {"mode": m["mode"], "steps": {}, "http_5xx": []}

    def note_5xx(r: httpx.Response) -> None:
        if r.status_code >= 500:
            raw["http_5xx"].append(f"{r.request.method} {r.request.url.path} -> {r.status_code}")

    c = httpx.Client(
        base_url=f"{a.base}/api/v1",
        headers={"Authorization": f"Bearer {a.token}"},
        timeout=120,
        event_hooks={"response": [note_5xx]},
    )
    try:
        _run(c, a, m, raw)
    finally:
        c.close()
        a.out.parent.mkdir(parents=True, exist_ok=True)
        a.out.write_text(json.dumps(raw, indent=2, default=str) + "\n")
    print(json.dumps({k: v.get("pass") if isinstance(v, dict) else None for k, v in raw["steps"].items()}))
    return 0


def _run(c: httpx.Client, a, m: dict, raw: dict) -> None:
    steps = raw["steps"]
    pid = check(c.post("/projects", json={"name": "Maps acceptance", "folder": a.project_folder}), 201)["id"]
    maps: dict = {}
    surfaces: dict = {}

    def imports() -> None:
        t = time.time()
        for o in m["orthos"]:
            gm, jid = split(check(c.post(f"/projects/{pid}/maps", json={"path": o["path"]}), 202))
            wait(c, pid, jid)
            check(c.patch(f"/projects/{pid}/maps/{gm['id']}", json={"captured_on": o["date"]}))
            maps[o["date"]] = gm["id"]
        for d in m["dsms"]:
            body = {"path": d["path"], "name": Path(d["path"]).stem, "role": d["role"]}
            if d["date"]:
                body["captured_on"] = d["date"]
            s, jid = split(check(c.post(f"/projects/{pid}/elevations", json=body), 202))
            wait(c, pid, jid)
            surfaces[d["date"] or "dtm"] = s["id"]
        steps["imports"] = {
            "maps": len(maps),
            "surfaces": len(surfaces),
            "seconds": round(time.time() - t, 1),
            "pass": imports_pass(m, maps, surfaces),
        }

    run_step(raw, "imports", imports)

    def frame() -> None:
        ws = check(c.get(f"/projects/{pid}/map-workspace"))
        f = ws["frame"]
        steps["frame"] = {
            "kind": f["kind"],
            "epsg": f["epsg"],
            "name": f["name"],
            "frame_items": ws.get("frame_items"),
            "pass": f["kind"] == "crs" and f["epsg"] == m["epsg"],
        }
        layers = check(c.get(f"/projects/{pid}/map-workspace/layers"))["items"]
        steps["layers"] = {
            "items": [
                {k: layer.get(k) for k in ("kind", "group", "status", "in_frame", "date", "max_zoom")}
                for layer in layers
            ],
            "pass": layers_pass(layers, len(maps) + len(surfaces)),
        }

    run_step(raw, "frame", frame)

    def dxf_step() -> None:
        """DXF placed by its CRS; offset of its linework against the known features (<= 0.1 m)."""
        insp, jid = split(
            check(c.post(f"/projects/{pid}/drawing-inspections", json={"path": m["dxf"]["path"]}), 202)
        )
        wait(c, pid, jid)
        placement = {"method": "crs", "crs": f"EPSG:{m['dxf']['epsg']}"}
        body = {"inspection_id": insp["id"], "name": "Site plan", "placement": placement}
        dxf, jid = split(check(c.post(f"/projects/{pid}/drawings", json=body), 202))
        wait(c, pid, jid)
        dxf = check(c.get(f"/projects/{pid}/drawings/{dxf['id']}"))
        z = 16
        size = 256 * RES0 / 2**z
        # The tile is chosen 1 cm towards the plan's centre: a check point on a tile edge (the
        # circle's east point) would otherwise pick the tile the feature only touches.
        xs = [p[0] for p in m["dxf"]["check_points"]]
        ys = [p[1] for p in m["dxf"]["check_points"]]
        ce, cn = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2
        offsets = []
        for e, n in m["dxf"]["check_points"]:
            te = e + math.copysign(0.01, ce - e) if e != ce else e
            tn = n + math.copysign(0.01, cn - n) if n != cn else n
            x, y = math.floor(te / size), math.floor(-tn / size)
            r = c.get(
                f"/projects/{pid}/drawings/{dxf['id']}/vtiles/{z}/{x}/{y}",
                params={"v": str(dxf.get("georef_version", 0))},
            )
            vt = check(r, 200, 204)
            best = math.inf
            for layer in vt.get("layers", []):
                for line in layer["lines"]:
                    pts = list(zip(line[0::2], line[1::2], strict=True))
                    for p0, p1 in zip(pts[:-1], pts[1:], strict=True):
                        best = min(best, seg_dist((e, n), p0, p1))
            offsets.append(None if best == math.inf else round(best, 4))
        worst = None if not offsets or None in offsets else max(offsets)
        steps["dxf"] = {
            "method": (dxf.get("georef") or {}).get("method"),
            "epsg": (dxf.get("georef") or {}).get("epsg"),
            "max_offset_m": worst,
            "offsets_m": offsets,
            "pass": worst is not None and worst <= 0.1,
        }

    run_step(raw, "dxf", dxf_step)

    def pdf_step() -> None:
        """PDF with four control points; RMSE reported."""
        insp, jid = split(
            check(c.post(f"/projects/{pid}/drawing-inspections", json={"path": m["pdf"]["path"]}), 202)
        )
        wait(c, pid, jid)
        body = {
            "inspection_id": insp["id"],
            "name": "Foundation plan",
            "page": 1,
            "dpi": m["pdf"]["dpi"],
            "placement": {"method": "none"},
        }
        pdf, jid = split(check(c.post(f"/projects/{pid}/drawings", json=body), 202))
        wait(c, pid, jid)
        points = [
            {"id": str(i + 1), "src": p["src"], "dst": p["dst"]}
            for i, p in enumerate(m["pdf"]["control_points"])
        ]
        placed = check(
            c.put(
                f"/projects/{pid}/drawings/{pdf['id']}/georef",
                json={"model": "similarity", "points": points, "dst_frame": "site"},
            )
        )
        g = placed["georef"]
        steps["pdf"] = {
            "model": g["model"],
            "rmse_m": g["rmse_m"],
            "residuals_m": g["residuals_m"],
            "warnings": g["warnings"],
            "georef_version": placed["georef_version"],
            "pass": g["rmse_m"] is not None and len(g["residuals_m"]) == len(points) > 0,
        }

    run_step(raw, "pdf", pdf_step)

    def measurements() -> None:
        """Distance, area, profile (server-computed; spec M13, section 9.2); vertices in the site frame."""
        ms = {}
        profile_ids = [surfaces["2026-08-14"], surfaces["2026-09-14"]]
        for kind, pts, extra in (
            ("distance", m["distance"], {"surface_ids": [surfaces["2026-09-14"]]}),
            ("area", m["area"], {}),
            ("profile", m["profile"], {"surface_ids": profile_ids}),
        ):
            mm = check(
                c.post(
                    f"/projects/{pid}/map-measurements",
                    json={"kind": kind, "name": kind, "vertices": pts, **extra},
                ),
                201,
            )
            res = mm["results"]
            if kind == "profile":
                keep = (
                    "length_m",
                    "grid_length_m",
                    "z_min",
                    "z_max",
                    "cut_area_m2",
                    "fill_area_m2",
                    "nodata_fraction",
                )
                ms[kind] = {k: res.get(k) for k in keep}
                ms[kind]["series"] = len(res.get("series") or [])
            else:
                ms[kind] = {k: v for k, v in res.items() if v is not None and not isinstance(v, list)}
        # The drawn figure is exact in the site grid; length_m/area_m2 are the true (scale-corrected)
        # values, so the check is on the grid ones against the figure's own plane geometry.
        dv, av = m["distance"], m["area"]
        grid_len = sum(math.dist(p, q) for p, q in zip(dv[:-1], dv[1:], strict=True))
        grid_area = abs(sum(p[0] * q[1] - q[0] * p[1] for p, q in zip(av, av[1:] + av[:1], strict=True))) / 2
        d_ok = abs(ms["distance"]["grid_length_m"] - grid_len) <= 0.01
        a_ok = abs(ms["area"]["grid_area_m2"] - grid_area) <= 0.01
        ms["expected_grid"] = {"length_m": grid_len, "area_m2": grid_area}
        steps["measurements"] = {**ms, "pass": d_ok and a_ok and ms["profile"]["series"] == 2}

    run_step(raw, "measurements", measurements)

    def volumes() -> None:
        """One stockpile against the four bases (spec section 10); the Sep DSM on top."""
        bases = {
            "lowest_point": {"kind": "toe_lowest"},
            "best_fit_plane": {"kind": "toe_plane"},
            "design_dtm": {"kind": "surface", "surface_id": surfaces["dtm"]},
            "earlier_survey": {"kind": "surface", "surface_id": surfaces["2026-08-14"]},
        }
        cone = (m.get("expected") or {}).get("sep_cone_m3")
        vols = {}
        for label, base in bases.items():
            body = {
                "name": f"Pile ({label})",
                "polygon_site": m["stockpile"],
                "top_surface_id": surfaces["2026-09-14"],
                "base": base,
            }
            v, jid = split(check(c.post(f"/projects/{pid}/volumes", json=body), 202))
            wait(c, pid, jid)
            got = check(c.get(f"/projects/{pid}/volumes/{v['id']}"))
            r = got["results"] or {}
            vols[label] = {
                "status": got["status"],
                **{k: r.get(k) for k in ("net_m3", "cut_m3", "fill_m3", "area_m2")},
            }
            if cone and r.get("net_m3") is not None:
                vols[label]["vs_cone_pct"] = round(100.0 * (r["net_m3"] - cone) / cone, 3)
        plane = vols["best_fit_plane"].get("net_m3")
        steps["volumes"] = {
            "results": vols,
            "expected": m.get("expected"),
            "pass": bool(cone) and plane is not None and abs(plane - cone) <= VOLUME_TOLERANCE * cone,
        }

    run_step(raw, "volumes", volumes)

    def crosscheck() -> None:
        """DSM import vs the same DSM built from the cloud (operator data only; median |dz| <= 0.02 m).
        <= 400 sample points."""
        cloud_dsm = m.get("cloud_dsm_surface_id")
        if not cloud_dsm:
            steps["dsm_crosscheck"] = {"pass": None, "note": "operator data needed (walkthrough)"}
            return
        dem = surfaces["2026-09-14"]  # the Sep DSM (R-T15), the volumes' top surface
        e0, n0 = m["stockpile"][0]
        dz = []
        for i in range(20):
            for j in range(20):
                s = check(
                    c.post(
                        f"/projects/{pid}/map-workspace/sample",
                        json={"x": e0 + i * 2.5, "y": n0 - j * 2.5, "surface_ids": [dem, cloud_dsm]},
                    )
                )
                zs = {it["surface_id"]: it["z"] for it in s["samples"]}
                if zs.get(dem) is not None and zs.get(cloud_dsm) is not None:
                    dz.append(abs(zs[dem] - zs[cloud_dsm]))
        med = statistics.median(dz) if dz else None
        steps["dsm_crosscheck"] = {
            "median_abs_dz_m": med,
            "n": len(dz),
            "pass": med is not None and med <= 0.02,
        }

    run_step(raw, "dsm_crosscheck", crosscheck)

    def union() -> None:
        items = check(c.get(f"/projects/{pid}/measurements", params={"limit": 50}))["items"]
        kinds = sorted({f"{u['kind']}/{u['sub_kind']}" for u in items})
        steps["union"] = {"kinds": kinds, "count": len(items), "pass": len(items) >= 7}

    run_step(raw, "union", union)


if __name__ == "__main__":
    sys.exit(main())
