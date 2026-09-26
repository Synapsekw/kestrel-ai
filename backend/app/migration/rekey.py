"""Rekeying the JSON that names old class ids (foundation spec §11.4 step 2). Pure functions.

Two old classes may map to one type (two spellings of one name), so counts are **summed** under
the new key, never overwritten. Keys and values with no mapping are kept as they are: after a
first run nothing maps any more, so a second run changes nothing.
"""


def rekey_counts(counts: dict | None, mapping: dict[str, str]) -> dict:
    """{class_id: n} -> {type_id: n}."""
    out: dict = {}
    for key, n in (counts or {}).items():
        new = mapping.get(key, key)
        out[new] = out.get(new, 0) + n
    return out


def rekey_area_counts(area_counts: dict | None, mapping: dict[str, str]) -> dict:
    """{area_id: {class_id: {"total": n, "verified": n}}} -> the same keyed by type id."""
    out: dict = {}
    for area, per_class in (area_counts or {}).items():
        merged: dict = {}
        for key, fields in (per_class or {}).items():
            target = merged.setdefault(mapping.get(key, key), {})
            for field, n in (fields or {}).items():
                target[field] = target.get(field, 0) + n
        out[area] = merged
    return out


def remap_values(class_map: dict | None, mapping: dict[str, str]) -> dict:
    """{model class name: class_id | None} -> {model class name: type_id | None}."""
    return {name: (mapping.get(v, v) if v else v) for name, v in (class_map or {}).items()}


def remap_classes(classes: list | None, mapping: dict[str, str]) -> list:
    """A dataset's frozen [{id, name, ...}]: the id follows, the name and order stay."""
    return [{**c, "id": mapping.get(c.get("id"), c.get("id"))} for c in (classes or [])]
