"""The catalogue as the models backend sees it (plan BM Tasks 2 and 11): one port, a 503 when BC's
catalogue did not open, and the in-memory fake the dataset tests use."""

from types import SimpleNamespace

import pytest
from catalogue_fake import FakeCatalogue, normalise_name

from app.errors import AppError
from app.library.catalogue_port import catalogue_of


def test_a_catalogue_that_did_not_open_is_a_503():
    with pytest.raises(AppError) as e:
        catalogue_of(SimpleNamespace(catalogue=None))
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
