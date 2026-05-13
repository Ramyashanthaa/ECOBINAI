"""
Unit tests for the waste classifier — uses a mock Gemma 4 client
so no API key is required in CI.
"""

import json
from unittest.mock import patch

import pytest

from backend.classifier.waste_classifier import classify_waste, CATEGORY_COLORS, CATEGORY_ICONS
from backend.hardware.simulator import BinSimulator
from tests.conftest import make_test_jpeg


MOCK_RECYCLABLE = {
    "item_identified": "empty plastic bottle",
    "category": "RECYCLABLE",
    "confidence": 0.97,
    "is_contaminated": False,
    "contamination_details": "",
    "reasoning": "Clean PET bottle — recyclable.",
    "bin_action": "OPEN_RECYCLABLE",
    "education_tip": "Rinse before recycling.",
}

MOCK_CONTAMINATED = {
    "item_identified": "plastic bottle with ketchup residue",
    "category": "TRASH",
    "confidence": 0.94,
    "is_contaminated": True,
    "contamination_details": "Food residue inside the bottle",
    "reasoning": "Contaminated recyclable → trash.",
    "bin_action": "OPEN_TRASH",
    "education_tip": "Always rinse containers before recycling.",
}

MOCK_COMPOST = {
    "item_identified": "banana peel",
    "category": "COMPOST",
    "confidence": 0.99,
    "is_contaminated": False,
    "contamination_details": "",
    "reasoning": "Organic material — compost.",
    "bin_action": "OPEN_COMPOST",
    "education_tip": "Composting enriches soil naturally.",
}

MOCK_HAZARDOUS = {
    "item_identified": "AA battery",
    "category": "HAZARDOUS",
    "confidence": 0.98,
    "is_contaminated": False,
    "contamination_details": "",
    "reasoning": "Contains toxic chemicals.",
    "bin_action": "OPEN_HAZARDOUS",
    "education_tip": "Take to a battery collection point.",
}


@pytest.mark.parametrize("mock_result,expected_cat", [
    (MOCK_RECYCLABLE,   "RECYCLABLE"),
    (MOCK_CONTAMINATED, "TRASH"),
    (MOCK_COMPOST,      "COMPOST"),
    (MOCK_HAZARDOUS,    "HAZARDOUS"),
])
def test_classify_waste_categories(mock_result, expected_cat):
    with patch("backend.classifier.waste_classifier.classify_image", return_value=mock_result):
        result = classify_waste(make_test_jpeg())
    assert result.category == expected_cat
    assert result.confidence > 0
    assert result.bin_action.startswith("OPEN_")


def test_contamination_flag():
    with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_CONTAMINATED):
        result = classify_waste(make_test_jpeg())
    assert result.is_contaminated is True
    assert result.category == "TRASH"
    assert "residue" in result.contamination_details.lower()


def test_clean_recyclable_not_contaminated():
    with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_RECYCLABLE):
        result = classify_waste(make_test_jpeg())
    assert result.is_contaminated is False
    assert result.category == "RECYCLABLE"


def test_result_has_color_and_icon():
    with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_RECYCLABLE):
        result = classify_waste(make_test_jpeg())
    assert result.color == CATEGORY_COLORS["RECYCLABLE"]
    assert result.icon == CATEGORY_ICONS["RECYCLABLE"]


def test_processing_time_recorded():
    with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_RECYCLABLE):
        result = classify_waste(make_test_jpeg())
    assert result.processing_time_ms >= 0


def test_controller_called_on_classification():
    sim = BinSimulator()
    opened_bins = []
    original_open = sim.open_lid
    def recording_open(bin_type, duration=5):
        opened_bins.append(bin_type)
        original_open(bin_type, duration)
    sim.open_lid = recording_open

    with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_RECYCLABLE):
        classify_waste(make_test_jpeg(), controller=sim)
    assert opened_bins == ["RECYCLABLE"]


def test_db_event_created(db_session):
    from backend.database.crud import get_total_events
    before = get_total_events(db_session)
    with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_COMPOST):
        classify_waste(make_test_jpeg(), db_session=db_session)
    after = get_total_events(db_session)
    assert after == before + 1
