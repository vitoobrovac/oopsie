import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi.testclient import TestClient

from main import app, database

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
