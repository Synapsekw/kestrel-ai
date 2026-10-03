"""Cowork's 34 materials (spec 2026-10-03-plant-model-generator §7; plan F0 Task 5).

name -> (baseColorFactor RGBA, metallic, roughness), copied verbatim from the materials of
KIPIC_AlZour_LNG_Plant.glb. They are written into the GLB exactly as they are, with no sRGB to
linear step (they already are that GLB's factors), so a Kestrel plant looks like Cowork's in the
same viewer. Builders name a material by its key; `build_item` refuses any other name.
"""

from __future__ import annotations

from functools import cache

from trimesh.visual.material import PBRMaterial

RGBA = tuple[float, float, float, float]

PALETTE: dict[str, tuple[RGBA, float, float]] = {
    "Concrete_Tank": ((0.8, 0.79, 0.76, 1.0), 0.0, 0.85),
    "Concrete": ((0.66, 0.65, 0.62, 1.0), 0.0, 0.9),
    "Concrete_Dark": ((0.42, 0.42, 0.41, 1.0), 0.0, 0.9),
    "Steel_Structure": ((0.47, 0.5, 0.53, 1.0), 0.5, 0.55),
    "Steel_Dark": ((0.24, 0.26, 0.28, 1.0), 0.6, 0.5),
    "Grating": ((0.4, 0.42, 0.4, 1.0), 0.5, 0.6),
    "Handrail": ((0.89, 0.54, 0.01, 1.0), 0.2, 0.5),
    "Equipment_White": ((0.88, 0.88, 0.86, 1.0), 0.1, 0.5),
    "Equipment_Grey": ((0.7, 0.72, 0.73, 1.0), 0.3, 0.5),
    "Insulation_Clad": ((0.78, 0.8, 0.82, 1.0), 0.7, 0.35),
    "Pump_Blue": ((0.18, 0.33, 0.55, 1.0), 0.3, 0.5),
    "Machine_Green": ((0.28, 0.42, 0.33, 1.0), 0.3, 0.55),
    "Aluminium_Panel": ((0.82, 0.84, 0.86, 1.0), 0.8, 0.3),
    "Pipe": ((0.62, 0.64, 0.66, 1.0), 0.6, 0.45),
    "Pipe_Insulated": ((0.83, 0.84, 0.84, 1.0), 0.6, 0.4),
    "Building_Wall": ((0.86, 0.82, 0.74, 1.0), 0.0, 0.85),
    "Building_Roof": ((0.62, 0.62, 0.6, 1.0), 0.1, 0.8),
    "Shelter_Roof": ((0.55, 0.6, 0.64, 1.0), 0.4, 0.6),
    "Glass": ((0.25, 0.33, 0.4, 1.0), 0.6, 0.15),
    "Ground": ((0.74, 0.66, 0.52, 1.0), 0.0, 0.98),
    "Ground_Mainland": ((0.76, 0.68, 0.54, 1.0), 0.0, 0.98),
    "Asphalt": ((0.27, 0.28, 0.29, 1.0), 0.0, 0.9),
    "Paving": ((0.83, 0.83, 0.81, 1.0), 0.0, 0.9),
    "Laydown": ((0.64, 0.6, 0.53, 1.0), 0.0, 0.95),
    "Rock_Armour": ((0.47, 0.44, 0.4, 1.0), 0.0, 0.95),
    "Slope": ((0.72, 0.65, 0.52, 1.0), 0.0, 0.98),
    "Water_Pit": ((0.1, 0.16, 0.18, 1.0), 0.0, 0.3),
    "Sea": ((0.08, 0.3, 0.38, 1.0), 0.0, 0.25),
    "Fence": ((0.55, 0.58, 0.6, 0.45), 0.5, 0.5),
    "Safety_Red": ((0.7, 0.12, 0.1, 1.0), 0.2, 0.5),
    "Ship_Hull": ((0.16, 0.2, 0.26, 1.0), 0.3, 0.5),
    "Ship_Bottom": ((0.45, 0.12, 0.1, 1.0), 0.2, 0.6),
    "Ship_Deck": ((0.55, 0.55, 0.52, 1.0), 0.2, 0.7),
    "Zone_Line": ((0.85, 0.2, 0.15, 0.6), 0.0, 0.8),
}
BLEND = frozenset({"Fence", "Zone_Line"})  # alphaMode BLEND in the Cowork GLB
DOUBLE_SIDED = frozenset({"Rock_Armour", "Sea", "Fence", "Zone_Line"})
DEFAULT_MATERIAL = "Equipment_Grey"
# M1 part materials (spec.Material) for `composite` items and M1 parts under a plant.
M1_MATERIAL: dict[str, str] = {
    "paint": "Equipment_White",
    "steel": "Steel_Structure",
    "rubber": "Steel_Dark",
    "concrete": "Concrete",
    "grating": "Grating",
    "galvanised": "Aluminium_Panel",
    "glass": "Glass",
    "other": "Equipment_Grey",
}


@cache
def material(name: str) -> PBRMaterial:
    """The glTF material for a palette name; KeyError for any other name."""
    rgba, metallic, roughness = PALETTE[name]
    return PBRMaterial(
        name=name,
        baseColorFactor=list(rgba),
        metallicFactor=metallic,
        roughnessFactor=roughness,
        alphaMode="BLEND" if name in BLEND else None,
        doubleSided=name in DOUBLE_SIDED,
    )
