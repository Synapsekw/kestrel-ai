"""A minimal OGC GeoPackage 1.3 writer: polygon layers with attributes, through sqlite3 only.

Enough for QGIS, ArcGIS and Civil 3D to open the layers in the map's own CRS, without adding
fiona or pyogrio (and their GDAL vector drivers) to the frozen bundle. Geometry is a GeoPackage
binary header (magic, version, flags, srs id, xy envelope) followed by little-endian WKB.
"""

from __future__ import annotations

import sqlite3
import struct
from dataclasses import dataclass, field
from pathlib import Path

APPLICATION_ID = 0x47504B47  # "GPKG"
USER_VERSION = 10300
FLAGS = 0b011  # bit 0: little endian; bits 1-3 = 1: envelope is [minx, maxx, miny, maxy]
WGS84_WKT = (
    'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
    'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],AUTHORITY["EPSG","4326"]]'
)


@dataclass
class Layer:
    name: str
    columns: list[tuple[str, str]]  # (name, SQLite type)
    features: list[tuple[list[tuple[float, float]], dict]] = field(default_factory=list)


def _geometry(ring: list[tuple[float, float]], srs_id: int) -> bytes:
    closed = list(ring) + [ring[0]] if ring[0] != ring[-1] else list(ring)
    xs, ys = [p[0] for p in closed], [p[1] for p in closed]
    header = (
        b"GP"
        + bytes([0, FLAGS])
        + struct.pack("<i", srs_id)
        + struct.pack("<4d", min(xs), max(xs), min(ys), max(ys))
    )
    wkb = struct.pack("<BIII", 1, 3, 1, len(closed)) + b"".join(struct.pack("<2d", x, y) for x, y in closed)
    return header + wkb


def write_gpkg(
    path: Path,
    layers: list[Layer],
    *,
    srs_id: int,
    srs_name: str,
    organization: str,
    organization_id: int,
    wkt: str,
) -> None:
    path.unlink(missing_ok=True)
    con = sqlite3.connect(path)
    try:
        con.execute(f"PRAGMA application_id = {APPLICATION_ID}")
        con.execute(f"PRAGMA user_version = {USER_VERSION}")
        con.executescript(
            """
            CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT NOT NULL, srs_id INTEGER PRIMARY KEY,
              organization TEXT NOT NULL, organization_coordsys_id INTEGER NOT NULL, definition TEXT NOT NULL,
              description TEXT);
            CREATE TABLE gpkg_contents (table_name TEXT NOT NULL PRIMARY KEY, data_type TEXT NOT NULL,
              identifier TEXT UNIQUE, description TEXT DEFAULT '',
              last_change DATETIME NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
              min_x DOUBLE, min_y DOUBLE, max_x DOUBLE, max_y DOUBLE, srs_id INTEGER,
              CONSTRAINT fk_gc_r_srs_id FOREIGN KEY (srs_id) REFERENCES gpkg_spatial_ref_sys(srs_id));
            CREATE TABLE gpkg_geometry_columns (table_name TEXT NOT NULL, column_name TEXT NOT NULL,
              geometry_type_name TEXT NOT NULL, srs_id INTEGER NOT NULL, z TINYINT NOT NULL,
              m TINYINT NOT NULL,
              CONSTRAINT pk_geom_cols PRIMARY KEY (table_name, column_name));
            """
        )
        srs_rows = [
            ("Undefined cartesian SRS", -1, "NONE", -1, "undefined"),
            ("Undefined geographic SRS", 0, "NONE", 0, "undefined"),
            ("WGS 84 geodetic", 4326, "EPSG", 4326, WGS84_WKT),
        ]
        if srs_id not in (-1, 0, 4326):
            srs_rows.append((srs_name, srs_id, organization, organization_id, wkt))
        con.executemany(
            "INSERT INTO gpkg_spatial_ref_sys"
            " (srs_name, srs_id, organization, organization_coordsys_id, definition)"
            " VALUES (?,?,?,?,?)",
            srs_rows,
        )
        for layer in layers:
            cols = "".join(f', "{name}" {kind}' for name, kind in layer.columns)
            con.execute(
                f'CREATE TABLE "{layer.name}" (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom POLYGON{cols})'
            )
            placeholders = ",".join("?" * (len(layer.columns) + 1))
            names = ",".join(["geom"] + [f'"{n}"' for n, _ in layer.columns])
            con.executemany(
                f'INSERT INTO "{layer.name}" ({names}) VALUES ({placeholders})',
                [
                    [_geometry(ring, srs_id)] + [props.get(n) for n, _ in layer.columns]
                    for ring, props in layer.features
                ],
            )
            pts = [p for ring, _ in layer.features for p in ring]
            env = (
                (
                    min(p[0] for p in pts),
                    min(p[1] for p in pts),
                    max(p[0] for p in pts),
                    max(p[1] for p in pts),
                )
                if pts
                else (None,) * 4
            )
            con.execute(
                "INSERT INTO gpkg_contents"
                " (table_name, data_type, identifier, min_x, min_y, max_x, max_y, srs_id)"
                " VALUES (?,?,?,?,?,?,?,?)",
                (layer.name, "features", layer.name, *env, srs_id),
            )
            con.execute(
                "INSERT INTO gpkg_geometry_columns VALUES (?, 'geom', 'POLYGON', ?, 0, 0)",
                (layer.name, srs_id),
            )
        con.commit()
    finally:
        con.close()
