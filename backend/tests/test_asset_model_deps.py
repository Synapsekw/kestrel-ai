"""trimesh and its polygon triangulator are importable (U1 Task 1)."""

from shapely.geometry import Polygon


def test_trimesh_extrudes_a_polygon():
    import trimesh

    mesh = trimesh.creation.extrude_polygon(Polygon([(0, 0), (1, 0), (1, 1), (0, 1)]), 2.0)
    assert mesh.is_watertight
    assert abs(mesh.volume - 2.0) < 1e-9
