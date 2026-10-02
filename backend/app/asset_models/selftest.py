"""`kestrel-backend.exe asset-models-selftest`: proves the frozen bundle carries trimesh's revolve,
extrusion (mapbox-earcut) and GLB exporter. Builds a two-part spec and prints its triangle count."""

from __future__ import annotations


def main() -> int:
    from app.asset_models.build import build_glb
    from app.asset_models.spec import AssetSpec

    spec = AssetSpec.model_validate(
        {
            "parts": [
                {
                    "id": "s",
                    "name": "s",
                    "group": "Shell",
                    "shape": "cylinder",
                    "params": {"id": 1000, "thickness": 10, "height": 1000},
                    "source": {"kind": "assumed"},
                },
                {
                    "id": "e",
                    "name": "e",
                    "group": "Other",
                    "shape": "extrusion",
                    "params": {"outline_mm": [[0, 0], [100, 0], [100, 10]], "height": 50},
                    "source": {"kind": "assumed"},
                },
            ]
        }
    )
    glb, meta = build_glb(spec)
    print(f"asset-models ok {meta['triangles']} {len(glb)}")
    return 0
