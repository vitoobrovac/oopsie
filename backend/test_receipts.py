import json
import unittest
from datetime import date
from decimal import Decimal
from io import BytesIO
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from exchange_rates import ExchangeRate, RateUnavailable, parse_rates
from main import app, database
from receipt_pipeline import normalize_photo

PRODUCT = {
    "kind": "product", "receipt_name": "SHOP  PEARS", "display_name": "Pears",
    "category": "Fruit", "aliases": ["pear"], "quantity": 0.52, "unit": "kg",
    "amount_minor": 250, "remember": True,
}
RECEIPT = {
    "id": "11111111-1111-4111-8111-111111111111",
    "store": "Sample Market", "date": "2026-09-30", "currency": "EUR",
    "total_minor": 250, "lines": [PRODUCT],
}


class ReceiptApiTest(unittest.TestCase):
    def tearDown(self):
        app.dependency_overrides.pop(database, None)

    def test_analysis_and_saves_require_authentication(self):
        with TestClient(app) as client:
            self.assertEqual(client.post("/v1/receipts/analyze").status_code, 401)
            self.assertEqual(client.post("/v1/receipts", json=RECEIPT).status_code, 401)
            self.assertEqual(client.get("/v1/receipts").status_code, 401)

    def test_review_reads_remembered_names_without_writing(self):
        app.dependency_overrides[database] = lambda: httpx.AsyncClient(
            base_url="https://example.test/rest/v1/"
        )
        draft = {"store": "Sample Market", "lines": [{**PRODUCT, "review": True}]}
        responses = [{"id": "test"}, [{"receipt_key": "shop pears", "display_name": "Green pears", "category": "Fresh fruit"}]]
        with patch("main.analyze", return_value=draft), patch("main.request", new=AsyncMock(side_effect=responses)) as db:
            with TestClient(app) as client:
                response = client.post("/v1/receipts/analyze", content=b"sample", headers={"Content-Type": "image/png"})
        self.assertEqual(response.status_code, 200)
        line = response.json()["lines"][0]
        self.assertEqual(line["display_name"], "Green pears")
        self.assertEqual(line["category"], "Fresh fruit")
        self.assertEqual([call.args[1] for call in db.await_args_list], ["GET", "GET"])
        self.assertEqual(db.await_args_list[1].kwargs["params"]["store_key"], "eq.sample market")

    def test_stream_reports_scan_stages_then_draft(self):
        app.dependency_overrides[database] = lambda: httpx.AsyncClient(base_url="https://example.test/rest/v1/")
        draft = {"store": "Sample Market", "lines": [{**PRODUCT, "review": False}]}

        def analyze(image, on_stage):
            self.assertEqual(image, b"sample")
            for stage in ("preparing", "reading", "parsing", "matching"):
                on_stage(stage)
            return draft

        with patch("main.analyze", side_effect=analyze), patch(
            "main.request", new=AsyncMock(side_effect=[{"id": "test"}, []])
        ), TestClient(app) as client:
            with client.stream("POST", "/v1/receipts/analyze", content=b"sample",
                               headers={"Content-Type": "image/png", "Accept": "application/x-ndjson"}) as response:
                self.assertEqual(response.status_code, 200)
                self.assertTrue(response.headers["content-type"].startswith("application/x-ndjson"))
                events = [json.loads(line) for line in response.iter_lines()]

        self.assertEqual([event["stage"] for event in events if event["type"] == "stage"],
                         ["preparing", "reading", "parsing", "matching", "checking"])
        self.assertEqual(events[-1], {"type": "result", "draft": draft})

    def test_save_reconciles_and_uses_one_rpc(self):
        app.dependency_overrides[database] = lambda: None
        with patch("main.request", new=AsyncMock(return_value=RECEIPT["id"])) as db:
            with TestClient(app) as client:
                self.assertEqual(client.post("/v1/receipts", json={**RECEIPT, "total_minor": 249}).status_code, 422)
                self.assertEqual(client.post("/v1/receipts", json={**RECEIPT, "lines": [{**PRODUCT, "amount_minor": -250}]}).status_code, 422)
                self.assertEqual(client.post("/v1/receipts", json=RECEIPT).status_code, 201)
        self.assertEqual(db.await_count, 1)
        self.assertEqual(db.await_args.args[1:], ("POST", "rpc/save_receipt"))
        self.assertTrue(db.await_args.kwargs["json"]["lines"][0]["remember"])

    def test_foreign_receipt_uses_same_rate_and_reconciles_converted_lines(self):
        app.dependency_overrides[database] = lambda: None
        quote = ExchangeRate(date(2026, 11, 25), Decimal("3"))
        lines = [
            {**PRODUCT, "amount_minor": 100},
            {**PRODUCT, "amount_minor": 100},
            {**PRODUCT, "kind": "discount", "amount_minor": -2, "remember": False},
        ]
        foreign = {**RECEIPT, "currency": "USD", "total_minor": 198, "lines": lines}
        with patch("main.latest_rate", new=AsyncMock(return_value=quote)), patch(
            "main.request", new=AsyncMock(return_value=RECEIPT["id"])
        ) as db, TestClient(app) as client:
            self.assertEqual(client.get("/v1/receipts/exchange-rate?currency=USD").status_code, 401)
            response = client.get("/v1/receipts/exchange-rate?currency=USD", headers={"Authorization": "Bearer mock"})
            self.assertEqual(response.json(), {"rate_date": "2026-11-25", "units_per_eur": "3"})
            self.assertEqual(client.post("/v1/receipts", json={**foreign, "rate_date": "2026-11-24"}).status_code, 409)
            self.assertEqual(client.post("/v1/receipts", json={**foreign, "rate_date": "2026-11-25"}).status_code, 201)
        db.assert_awaited_once()
        payload = db.await_args.kwargs["json"]
        self.assertEqual(payload["total"], 66)
        self.assertEqual([line["amount_minor"] for line in payload["lines"]], [34, 33, -1])
        self.assertEqual(payload["lines"][0]["quantity"], "0.52")

    def test_rate_outage_does_not_save_foreign_receipt(self):
        app.dependency_overrides[database] = lambda: None
        with patch("main.latest_rate", new=AsyncMock(side_effect=RateUnavailable)), patch(
            "main.request", new=AsyncMock()
        ) as db, TestClient(app) as client:
            response = client.post("/v1/receipts", json={**RECEIPT, "currency": "CAD"})
        self.assertEqual(response.status_code, 503)
        db.assert_not_awaited()

    def test_parses_ecb_daily_xml(self):
        rates = parse_rates(b"""
            <Envelope xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
              <Cube><Cube time="2026-11-25"><Cube currency="USD" rate="1.0935"/></Cube></Cube>
            </Envelope>
        """)
        self.assertEqual(rates["USD"], ExchangeRate(date(2026, 11, 25), Decimal("1.0935")))

    def test_large_phone_jpeg_is_resized_and_rotated_for_ocr(self):
        from PIL import Image

        original = BytesIO()
        with Image.new("RGB", (2400, 1200), "white") as image:
            exif = image.getexif()
            exif[274] = 6
            image.save(original, format="JPEG", exif=exif)
        with Image.open(BytesIO(normalize_photo(original.getvalue()))) as photo:
            self.assertEqual(photo.size, (900, 1800))
            self.assertIsNone(photo.getexif().get(274))
