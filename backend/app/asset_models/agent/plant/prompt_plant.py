# backend/app/asset_models/agent/plant/prompt_plant.py
# ruff: noqa: E501  (prompt text is prose; wrapping it would change what the model reads)
"""Plant run prompts (spec §8.5). The orchestrator and sub-run system prompts are constants, so they
are stable cached prefixes. The catalogue is appended to the sub-run prompt once per build. No keys,
no file-system paths: sources are named by their labels."""

from __future__ import annotations

from collections import Counter

ORCH_SYSTEM = """You run a plant model build. From a project's engineering drawings (and later its point cloud and ortho photo) you produce a typed register of every asset the drawings show. App code turns the register into a 3D model; you never write geometry or code.

The run has stages. The app tells you when each one starts:
1. survey - read the drawings, fix the site frame with set_site, split the tracing into packages with plan_packages, then call next_stage.
2. trace - sub-runs trace the packages in parallel. You wait.
3. review - the cloud check has run: name or leave the unregistered candidates, resolve the flags you can, then next_stage.
4. environment - trace land, sea, roads, paving and laydown areas from the overall plot plan with upsert_environment, checked against the ortho with ortho_view, then next_stage.
5. build - the app builds the model. Check it with render_site (plan, area:<label>, iso). You have up to two rounds of fixes, then call finish with a summary and honest open questions.

Frame. Item coordinates are plant metres [E, N] on the drawing's own plant grid; elevations are plant EL in metres. The 3D model frame is x = plant north, y = EL minus the datum, z = plant east. Bearings and rot_deg are clockwise from plant north.

Authority. The drawing decides plan position; the cloud decides height. Never move an item to match the cloud: a disagreement becomes a flag for the operator.

Reading scanned plot plans. They have no text layer, so read them with drawing_zoom. On each page find the title block (drawing number, title, scale, revision), the key plan (which part of the site the sheet shows), the grid labels (E and N values at the grid lines), the north arrow, and the equipment list or legend. Tags are small: zoom at 300 to 600 dpi into small regions, and zoom smaller when the note says the dpi was capped. A leader line joins a tag to its outline.

The site frame. Call set_site once. Either give grid points (at least two, better three or four far apart: each a grid intersection's page position read from drawing_zoom's page-fraction ticks plus its plant E/N labels) on a page that is already placed on the map, or give origin_crs and plant_north_deg read off a coordinate note or key plan, with their EPSG. A residual over 1 m means a misread point. Pages with grid points but no georeference are placed on the map from the grid.

Packages. A package is one region of one sheet, small enough for one sub-run: about 20 to 60 items. Trace from the area plot plans; use the overall plot plan for layout, for the environment, and for areas no area plan covers. Give each package a brief (what the region holds, the scale, anything hard to read) and the tags the equipment list says it holds (expected_tags). Avoid overlapping regions; items on a boundary are merged later.

Catalogue. Every item has a type from the builder catalogue (the catalogue tool). Use the most specific type. Use other (an extruded footprint) when nothing fits, and composite only for an item modelled from detailed M1 parts.

Honesty. Give heights only when a drawing states them (height_source drawing); otherwise give an indicative height (height_source indicative) or leave base_el and top_el empty. Confidence high only for what you read clearly. Never invent a tag: an item without a legible tag has tag null. Put what you could not read, and where sources disagree, in finish's open questions."""

SUB_SYSTEM = """You trace one package of a plant model build: one region of one drawing page. Write every asset you can see there to the register with upsert_items. App code builds the 3D geometry from the register.

Coordinates. Items are in plant metres [E, N] on the drawing's own plant grid, read from the grid labels; elevations are plant EL in metres. rot_deg and bearings are clockwise from plant north. Once the page is placed and the frame is set, drawing_zoom draws the plant E/N grid lines for you.

How to work:
1. drawing_zoom over the package region at a low dpi to see the layout, then zoom into smaller regions at 300 to 600 dpi to read tags, leaders, dimensions and grid labels.
2. For each asset: a footprint (rect for tanks' platforms, buildings and skids; circle for tanks and vessels seen from above; polygon for irregular outlines; line with a width for racks, roads, trestles, fences and pipes), its type from the catalogue below, its tag only if you can read it, and its area.
3. upsert_items in batches of up to 150. Each item is checked on its own; fix the rejected ones and send them again.
4. items_query to review what you saved and which expected tags are still missing.
5. finish_package with a short summary and the questions you could not answer.

Item fields: id (a slug unique in the plant: the tag in lower case such as 20-t-0001, else type-area-number), tag, name, type, area, footprint, base_el, top_el, levels, params (see catalogue type=<name> for the schema; leave out what the drawing does not give), height_source (drawing only when a drawing states the height, else indicative), source {kind: drawing, id: the drawing id, page, region: page fractions where you read it}, confidence (high only for what you read clearly), notes.

The drawing decides plan position; the cloud decides height. Never invent a tag: an item without a legible tag has tag null. Stay inside your package's region; items on its edge are merged with the neighbouring package later."""

SUB_NUDGE = "Continue with the tools, or call finish_package with a short summary."
WRAP_UP = (
    "The run's budget is used up. Save what you have traced with upsert_items now, then call finish_package. "
    "You have at most three more turns."
)
NUDGE = "Continue with the tools, or call next_stage (finish in the build stage)."


def sub_system(catalogue: str) -> str:
    return (
        f"{SUB_SYSTEM}\n\nThe builder catalogue, type (family, default height): what it builds:\n{catalogue}"
    )


def _budget_line(rc) -> str:
    lim = rc.limits
    return (
        f"Budget: {lim.max_tokens:,} tokens and {lim.max_images} images over the whole run, "
        f"{lim.max_seconds / 3600:g} h; up to {lim.parallel} packages run at once, each with up to "
        f"{lim.sub_calls} tool calls."
    )


def _source_lines(rc) -> list[str]:
    from app.asset_models.agent.tools import group_drawing_sources  # I1

    lines = [
        f"- drawing file {g['file']}: " + ", ".join(f"p{p['page'] or 1} {p['id']}" for p in g["pages"])
        for g in group_drawing_sources(rc.sources)
    ]
    lines += [
        f"- {s['type']} {s['id']}: {s.get('label', '')} ({s.get('facts', '')})"
        for s in rc.sources
        if s["type"] != "drawing"
    ]
    return lines


def first_message(rc) -> str:
    lines = [
        "Task: build a plant model of this project from its drawings.",
        "Sources (call list_sources to see the drawing pages grouped by file):",
    ]
    src = _source_lines(rc)
    lines += src[:60]
    if len(src) > 60:
        lines.append(f"- and {len(src) - 60} more (call list_sources for all of them)")
    lines.append(_budget_line(rc))
    if rc.notes:
        lines.append("The operator's notes:\n" + rc.notes)
    return "\n".join(lines)


def survey_message() -> str:
    return (
        "Stage: survey. Read every page's title block, key plan, grid labels and equipment list. Fix the site "
        "frame with set_site, plan the packages with plan_packages, then call next_stage."
    )


def _frame_line(rc) -> str:
    site = rc.site()
    if site is None:
        return "The site frame is not set."
    return (
        f"The site frame is set: plant north {site.plant_north_deg:.4f} deg clockwise from grid north, "
        f"datum {site.datum.label} = {site.datum.el_m:g} m."
    )


def review_message(rc) -> str:
    counts = Counter(f.code for i in rc.store.values() for f in i.flags)
    lines = [
        "Stage: review. The cloud check has run. The drawing decides plan position and the cloud decides "
        "height: never move an item to match the cloud.",
        f"The register has {len(rc.store)} items. Flags: "
        + (", ".join(f"{k} {v}" for k, v in sorted(counts.items())) or "none")
        + ".",
    ]
    if rc.state.check_summary:
        lines.append("Cloud check: " + rc.state.check_summary)
    if rc.state.candidates:
        lines.append(
            "Unregistered candidates (clusters in the cloud with no item), largest first. Name each real one "
            "as a new item with upsert_items (source kind cloud), or leave it:"
        )
        for c in rc.state.candidates[:100]:
            lines.append(
                f"- {c['id']}: centre E {c['e']:.1f} N {c['n']:.1f}, {c['size_m'][0]:.1f} x {c['size_m'][1]:.1f} m, "
                f"top EL {c['top_el']:.1f}"
            )
    lines += [f"Note: {n}" for n in rc.state.notes]
    lines.append(
        "Use items_query (flag=...), drawing_zoom and ortho_view to resolve what you can, then next_stage."
    )
    return "\n".join(lines)


def environment_message(rc) -> str:
    return (
        "Stage: environment. Trace land, sea, roads, paved and laydown areas from the overall plot plan with "
        "upsert_environment (polygons in plant metres, el in plant EL), check them against the ortho with "
        f"ortho_view where there is one, then next_stage. {_frame_line(rc)}"
    )


def build_message(rc, fallen: list[str]) -> str:
    lines = [f"Stage: build. The app built {len(rc.store)} items."]
    if fallen:
        lines.append(
            f"{len(fallen)} items fell back to `other` (their params did not fit their type's builder): "
            + ", ".join(fallen[:40])
            + ". Fix their params or type, or leave them."
        )
    lines.append(
        "Check the model with render_site (plan, area:<label>, iso) against the drawings and the ortho. You "
        "have up to two rounds of fixes, then call finish with a summary and honest open questions."
    )
    return "\n".join(lines)


def resume_message(rc) -> str:
    return "\n".join(
        [
            "This run was interrupted (the app closed) and has resumed. Earlier conversation is not available.",
            f"Stage reached: {rc.state.stage}. {_frame_line(rc)} The register has {len(rc.store)} items.",
            _budget_line(rc),
        ]
    )


def package_brief(w, rc) -> str:
    region = list(w.region) if w.region else "the whole page"
    lines = [
        f"Package P{w.n}: {w.label}",
        f"Drawing: {w.drawing_id}; region {region} (page fractions [x0, y0, x1, y1], (0,0) top-left).",
        f"Area: {w.area or 'not given'}.",
        f"Brief: {w.brief}",
    ]
    if w.expected_tags:
        lines.append("Expected tags (from the equipment list): " + ", ".join(w.expected_tags))
    lines.append(_frame_line(rc))
    return "\n".join(lines)
