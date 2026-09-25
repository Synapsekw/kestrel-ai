"""A QGIS style for the cut/fill GeoTIFF (spec §10): singleband pseudocolor, the same red/blue ramp
as the diff tiles at ± diff_scale_m. QGIS loads `<name>.qml` beside `<name>.tif` automatically."""

from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import quoteattr

from app.surfaces.tiles import DIFF_CUT, DIFF_FILL, DIFF_NEUTRAL, DIFF_NEUTRAL_BAND_M


def _hex(rgb) -> str:
    return "#{:02x}{:02x}{:02x}".format(*(int(v) for v in rgb))


def write_qml(path: Path, scale: float) -> None:
    stops = [
        (-scale, _hex(DIFF_CUT), f"-{scale:.2f} m (below base)"),
        (-DIFF_NEUTRAL_BAND_M, _hex(DIFF_NEUTRAL), f"-{DIFF_NEUTRAL_BAND_M:.2f} m"),
        (DIFF_NEUTRAL_BAND_M, _hex(DIFF_NEUTRAL), f"+{DIFF_NEUTRAL_BAND_M:.2f} m"),
        (scale, _hex(DIFF_FILL), f"+{scale:.2f} m (above base)"),
    ]
    items = "\n".join(
        f'          <item alpha="255" value="{v:.4f}" color="{c}" label={quoteattr(label)}/>'
        for v, c, label in stops
    )
    path.write_text(
        f"""<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<qgis version="3.34" styleCategories="Symbology">
  <pipe>
    <rasterrenderer type="singlebandpseudocolor" band="1" opacity="1"
                    classificationMin="{-scale:.4f}" classificationMax="{scale:.4f}">
      <rastershader>
        <colorrampshader colorRampType="INTERPOLATED" classificationMode="1" clip="0">
{items}
        </colorrampshader>
      </rastershader>
    </rasterrenderer>
  </pipe>
</qgis>
""",
        "utf-8",
    )
