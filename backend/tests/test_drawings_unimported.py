"""Project-folder drawings never imported (plant-model spec §8.1; I1 Rulings 6 to 10; Review Focus 3, 4)."""

import hashlib
import os
import shutil
import uuid
from pathlib import Path

from drawings_helpers import write_pdf as _write_pdf
from drawings_helpers import write_png

from app.db.models import Drawing
from app.drawings import store, unimported


def _root(handle) -> Path:
    return Path(handle.folder)


def _write(path: Path, data: bytes) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def write_pdf(path: Path, pages):
    path.parent.mkdir(parents=True, exist_ok=True)  # the shared helper does not create folders
    return _write_pdf(path, pages)


def _import(handle, path: Path, *, status="ready", at: Path | None = None):
    """A Drawing row for `path`'s bytes (as if imported from `at`, default the same path)."""
    src = at or path
    with handle.session() as s:
        s.add(
            Drawing(
                name=path.stem,
                format="pdf",
                source_path=str(src),
                source_size=path.stat().st_size,
                source_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                status=status,
            )
        )


def _names(handle) -> list[str]:
    return [f["name"] for f in unimported.scan_unimported(handle)]


def _count_hashes(monkeypatch) -> list[Path]:
    seen: list[Path] = []
    real = unimported._sha256

    def spy(path):
        seen.append(path)
        return real(path)

    monkeypatch.setattr(unimported, "_sha256", spy)
    return seen


def test_lists_a_new_pdf_with_its_page_count(handle):
    src = write_pdf(_root(handle) / "Drawings" / "T0005.pdf", [(200.0, 200.0)] * 3)
    files = unimported.scan_unimported(handle)
    assert files == [
        {"path": str(src), "name": "T0005.pdf", "format": "pdf", "size": src.stat().st_size, "pages": 3}
    ]


def test_an_imported_file_is_left_out_even_as_a_copy(handle):
    src = write_pdf(_root(handle) / "Drawings" / "T0005.pdf", [(200.0, 200.0)] * 2)
    _import(handle, src)
    (_root(handle) / "Old").mkdir()
    shutil.copyfile(src, _root(handle) / "Old" / "T0005-copy.pdf")
    assert _names(handle) == []


def test_a_same_size_file_with_other_bytes_is_listed(handle):
    a = _write(_root(handle) / "Drawings" / "a.pdf", b"%PDF-1.4 " + b"a" * 100)
    b = _write(_root(handle) / "Drawings" / "b.pdf", b"%PDF-1.4 " + b"b" * 100)
    _import(handle, a)
    files = unimported.scan_unimported(handle)
    assert [f["name"] for f in files] == ["b.pdf"]
    assert files[0]["pages"] is None  # not a readable PDF; still listed
    assert b.stat().st_size == a.stat().st_size


def test_no_file_is_hashed_when_no_imported_size_matches(handle, monkeypatch):
    seen = _count_hashes(monkeypatch)
    _write(_root(handle) / "Drawings" / "big.tif", b"II*\x00" + b"0" * 5000)
    imported = _write(_root(handle) / "elsewhere.pdf", b"%PDF " + b"z" * 10)
    _import(handle, imported, at=Path("C:/gone/elsewhere.pdf"))
    imported.unlink()
    assert _names(handle) == ["big.tif"]
    assert seen == []


def test_the_hash_is_cached_until_the_file_changes(handle, monkeypatch):
    a = _write(_root(handle) / "Drawings" / "a.pdf", b"%PDF " + b"a" * 50)
    b = _write(_root(handle) / "Drawings" / "b.pdf", b"%PDF " + b"b" * 50)
    _import(handle, a, at=Path("C:/elsewhere/a.pdf"))  # same size as b, another path: b must be hashed
    seen = _count_hashes(monkeypatch)
    assert sorted(_names(handle)) == ["b.pdf"]
    assert sorted(p.name for p in seen) == ["a.pdf", "b.pdf"]
    seen.clear()
    assert sorted(_names(handle)) == ["b.pdf"]
    assert seen == []  # both hashes came from the cache
    st = b.stat()
    os.utime(b, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))
    assert sorted(_names(handle)) == ["b.pdf"]
    assert [p.name for p in seen] == ["b.pdf"]
    cache = store.read_json(unimported.cache_path(handle))
    assert cache["version"] == 1 and str(b) in cache["entries"]


def test_skips_kestrel_folders_and_goes_three_deep(handle):
    root = _root(handle)
    for rel in (
        "cache/x.pdf",
        "images/x.png",
        "Maps/x.tif",
        ".git/x.pdf",
        f"drawings/{uuid.uuid4()}/plan.tif",
        f"Survey/{uuid.uuid4()}/thumb.png",
        "a/b/c/d/deep.pdf",
    ):
        _write(root / rel, b"%PDF x")
    _write(root / "a" / "b" / "c" / "ok.pdf", b"%PDF ok")
    _write(root / "drawings" / "T1.pdf", b"%PDF t1")
    _write(root / "top.dxf", b"0\nSECTION\n")
    assert sorted(_names(handle)) == ["T1.pdf", "ok.pdf", "top.dxf"]


def test_photo_folder_images_are_skipped(handle):
    root = _root(handle)
    for i in range(21):
        write_png(root / "Photos" / f"DJI_{i:04}.jpg", 4, 4)
    _write(root / "Photos" / "plan.pdf", b"%PDF p")
    write_png(root / "Site" / "a.png", 4, 4)
    write_png(root / "Site" / "b.png", 4, 4)
    assert sorted(_names(handle)) == ["a.png", "b.png", "plan.pdf"]


def test_xml_is_listed_only_when_it_is_landxml(handle):
    root = _root(handle)
    _write(root / "Drawings" / "survey.xml", b'<?xml version="1.0"?><LandXML version="1.2"></LandXML>')
    _write(root / "Drawings" / "meta.xml", b'<?xml version="1.0"?><rss></rss>')
    files = unimported.scan_unimported(handle)
    assert [(f["name"], f["format"]) for f in files] == [("survey.xml", "landxml")]


def test_answers_at_most_max_files(handle, monkeypatch):
    monkeypatch.setattr(unimported, "MAX_FILES", 2)
    for n in "abc":
        _write(_root(handle) / "Drawings" / f"{n}.pdf", f"%PDF {n}".encode())
    assert _names(handle) == ["a.pdf", "b.pdf"]


def test_the_walk_stops_at_max_entries(handle, monkeypatch):
    monkeypatch.setattr(unimported, "MAX_ENTRIES", 3)
    for n in range(10):
        _write(_root(handle) / f"f{n:02}" / "x.pdf", b"%PDF x")
    assert len(_names(handle)) < 10


def test_a_failed_drawing_does_not_hide_its_file(handle):
    src = _write(_root(handle) / "Drawings" / "f.pdf", b"%PDF f")
    _import(handle, src, status="failed")
    assert _names(handle) == ["f.pdf"]


def test_a_broken_cache_file_is_ignored_and_rewritten(handle):
    _write(_root(handle) / "Drawings" / "a.pdf", b"%PDF a")
    unimported.cache_path(handle).parent.mkdir(parents=True, exist_ok=True)
    unimported.cache_path(handle).write_text("{not json", "utf-8")
    assert _names(handle) == ["a.pdf"]
    assert store.read_json(unimported.cache_path(handle))["version"] == 1


def test_the_route_answers_and_is_not_read_as_a_drawing_id(client, project_id, handle):
    src = write_pdf(_root(handle) / "Drawings" / "T0006.pdf", [(200.0, 200.0)] * 2)
    r = client.get(f"/api/v1/projects/{project_id}/drawings/unimported")
    assert r.status_code == 200, r.text
    assert r.json() == {
        "files": [
            {"path": str(src), "name": "T0006.pdf", "format": "pdf", "size": src.stat().st_size, "pages": 2}
        ]
    }


def test_a_busy_pdfium_lock_lists_the_pdf_without_pages_and_does_not_cache_it(client, project_id, handle):
    import threading
    import time

    from app.drawings import pdf

    src = write_pdf(_root(handle) / "Drawings" / "busy.pdf", [(200.0, 200.0)] * 2)
    held, release = threading.Event(), threading.Event()

    def hold():
        with pdf._PDFIUM_LOCK:  # an import rendering a page holds it for tens of seconds
            held.set()
            release.wait(30)

    t = threading.Thread(target=hold, daemon=True)
    t.start()
    assert held.wait(5)
    try:
        t0 = time.monotonic()
        r = client.get(f"/api/v1/projects/{project_id}/drawings/unimported")
        assert time.monotonic() - t0 < 5
        assert r.status_code == 200, r.text
        files = r.json()["files"]
        assert [(f["name"], f["pages"]) for f in files] == [("busy.pdf", None)]
        cached = store.read_json(unimported.cache_path(handle))["entries"][str(src)]
        assert "pages" not in cached
    finally:
        release.set()
        t.join(5)
    assert [(f["name"], f["pages"]) for f in unimported.scan_unimported(handle)] == [("busy.pdf", 2)]
    assert store.read_json(unimported.cache_path(handle))["entries"][str(src)]["pages"] == 2
