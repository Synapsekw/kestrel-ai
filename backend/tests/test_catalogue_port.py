"""The catalogue as the models backend sees it (plan BM Task 2): one port, a pre-BC default that
knows no types, and the in-memory fake every BM test uses."""

from types import SimpleNamespace

import pytest
from catalogue_fake import FakeCatalogue, normalise_name

from app.errors import AppError
from app.library.catalogue_port import NO_CATALOGUE, catalogue_of


def test_without_a_catalogue_nothing_resolves_and_creating_is_503():
    port = catalogue_of(SimpleNamespace())
    assert port is NO_CATALOGUE
    assert port.resolve_types(["a"]) == {} and port.match_names(["a"]) == {}
    with pytest.raises(AppError) as e:
        port.ensure_types(["crane"])
    assert e.value.status == 503 and e.value.code == "catalogue_unavailable"


def test_an_installed_port_is_the_one_used():
    fake = FakeCatalogue()
    assert catalogue_of(SimpleNamespace(catalogue_port=fake)) is fake


@pytest.mark.parametrize(
    ("a", "b"), [("dump_truck", "Dump truck"), ("  Wheel-Loader ", "wheel loader"), ("crane", "CRANE")]
)
def test_normalise_name_follows_the_spec(a, b):
    assert normalise_name(a) == normalise_name(b)


def test_the_fake_matches_live_types_by_name_and_resolves_archived_ones():
    fake = FakeCatalogue()
    live = fake.add("Dump truck")
    old = fake.add("Crane", archived=True)
    assert fake.match_names(["dump_truck", "crane"]) == {"dump_truck": live}
    assert fake.resolve_types([old.id, "nope"]) == {old.id: old}
    made = fake.ensure_types(["crane", "dump_truck"])
    assert made["dump_truck"] == live
    assert made["crane"].id != old.id and made["crane"].kind == "object" and not made["crane"].archived
