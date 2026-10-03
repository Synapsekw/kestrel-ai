"""Asset findings C0: a report config names its brand (spec 2026-10-02-asset-findings §5.8, plan
af-c0 Task 3b). Null, or a config saved before the field existed, prints with the Kestrel theme."""

import pytest
from pydantic import ValidationError

from app.reports.schemas import ReportConfig


def test_a_new_config_has_no_brand():
    assert ReportConfig().brand_id is None
    assert ReportConfig().model_dump(mode="json", by_alias=True)["brand_id"] is None


def test_a_config_saved_before_brands_reads_none():
    raw = ReportConfig().model_dump(mode="json", by_alias=True)
    del raw["brand_id"]
    assert ReportConfig.model_validate(raw).brand_id is None


def test_a_brand_id_round_trips_and_is_bounded():
    assert ReportConfig.model_validate({"brand_id": "builtin-eand"}).brand_id == "builtin-eand"
    with pytest.raises(ValidationError):
        ReportConfig.model_validate({"brand_id": "x" * 65})
