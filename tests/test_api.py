"""
Integration tests for the FastAPI endpoints.
All Gemma 4 calls are mocked — no API key needed.
"""

import json
from unittest.mock import patch

import pytest

from tests.conftest import make_test_jpeg

MOCK_RESPONSE = {
    "item_identified": "empty glass bottle",
    "category": "RECYCLABLE",
    "confidence": 0.96,
    "is_contaminated": False,
    "contamination_details": "",
    "reasoning": "Clean glass bottle — recyclable.",
    "bin_action": "OPEN_RECYCLABLE",
    "education_tip": "Rinse and remove caps.",
}


class TestHealthEndpoint:
    def test_health_ok(self, client):
        res = client.get("/api/health")
        assert res.status_code == 200
        body = res.json()
        assert body["status"] == "ok"
        assert "backend" in body
        assert "model" in body


class TestClassifyEndpoint:
    def test_classify_returns_200(self, client, sample_jpeg):
        with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_RESPONSE):
            res = client.post(
                "/api/classify/image",
                files={"file": ("test.jpg", sample_jpeg, "image/jpeg")},
            )
        assert res.status_code == 200

    def test_classify_response_schema(self, client, sample_jpeg):
        with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_RESPONSE):
            res = client.post(
                "/api/classify/image",
                files={"file": ("test.jpg", sample_jpeg, "image/jpeg")},
            )
        body = res.json()
        required_keys = {
            "item_identified", "category", "confidence", "is_contaminated",
            "bin_action", "color", "icon", "timestamp", "processing_time_ms",
        }
        assert required_keys.issubset(body.keys())

    def test_classify_correct_category(self, client, sample_jpeg):
        with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_RESPONSE):
            res = client.post(
                "/api/classify/image",
                files={"file": ("test.jpg", sample_jpeg, "image/jpeg")},
            )
        assert res.json()["category"] == "RECYCLABLE"

    def test_classify_rejects_non_image(self, client):
        res = client.post(
            "/api/classify/image",
            files={"file": ("data.csv", b"col1,col2\n1,2", "text/csv")},
        )
        assert res.status_code == 415

    def test_classify_rejects_oversized_image(self, client):
        big_image = make_test_jpeg() * 200  # well over 10 MB
        res = client.post(
            "/api/classify/image",
            files={"file": ("big.jpg", big_image, "image/jpeg")},
        )
        assert res.status_code == 413

    def test_lid_states_endpoint(self, client):
        res = client.get("/api/classify/lid-states")
        assert res.status_code == 200
        body = res.json()
        assert set(body.keys()) == {"RECYCLABLE", "COMPOST", "TRASH", "HAZARDOUS"}
        for v in body.values():
            assert isinstance(v, bool)


class TestStatsEndpoint:
    def test_stats_empty_db(self, client):
        res = client.get("/api/stats/")
        assert res.status_code == 200
        body = res.json()
        assert "total_items" in body
        assert "category_counts" in body
        assert "contamination_rate" in body

    def test_recent_events_empty(self, client):
        res = client.get("/api/stats/recent")
        assert res.status_code == 200
        assert isinstance(res.json(), list)

    def test_stats_after_classification(self, client, sample_jpeg):
        with patch("backend.classifier.waste_classifier.classify_image", return_value=MOCK_RESPONSE):
            client.post(
                "/api/classify/image",
                files={"file": ("test.jpg", sample_jpeg, "image/jpeg")},
            )
        res = client.get("/api/stats/")
        body = res.json()
        assert body["total_items"] >= 1
        assert "RECYCLABLE" in body["category_counts"]
