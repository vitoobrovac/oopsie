import json
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from main import app

ENTRY = {
    "date": "2026-11-25",
    "name": "Dinner",
    "category": "Dining out",
    "amountMinor": -1250,
}
ENTRY_ID = "445a800c-afdc-46f9-aa6c-8077c648000b"


class LedgerApiTest(unittest.TestCase):
    def test_requires_sign_in(self):
        with TestClient(app) as client:
            self.assertEqual(client.get("/v1/ledger").status_code, 401)
            self.assertEqual(client.delete(f"/v1/transactions/{ENTRY_ID}").status_code, 401)

    def test_yearly_subscriptions_accept_annual_and_installment_schedules(self):
        from main import SubscriptionInput

        data = {"name": "Car registration", "amount_minor": 25001, "starts_on": "2026-12-01", "active": True}
        self.assertEqual(SubscriptionInput(**data, cadence="yearly").cadence, "yearly")
        self.assertEqual(SubscriptionInput(**data, cadence="yearly_split").amount_minor, 25001)
        with self.assertRaises(ValueError):
            SubscriptionInput(**{**data, "amount_minor": 11}, cadence="yearly_split")

    def test_planning_uses_owner_token_and_validated_cents(self):
        original_client = httpx.AsyncClient
        budget = {"category": "Groceries", "amount_minor": 42000}
        saved = {"id": ENTRY_ID, **budget}

        def database(request):
            self.assertEqual(request.headers["authorization"], "Bearer test-user")
            self.assertTrue(request.url.path.endswith("budgets"))
            if request.method == "GET":
                return httpx.Response(200, json=[saved])
            if request.method == "DELETE":
                return httpx.Response(204)
            self.assertEqual(json.loads(request.content), budget)
            return httpx.Response(201, json=[saved])

        env = {"SUPABASE_URL": "https://project.example", "SUPABASE_PUBLISHABLE_KEY": "test-project"}
        path = "/v1/planning/budgets"
        with TestClient(app) as anonymous:
            self.assertEqual(anonymous.get(path).status_code, 401)
        with patch.dict(os.environ, env), patch("main.httpx.AsyncClient", side_effect=lambda **kw: original_client(
            **kw, transport=httpx.MockTransport(database)
        )), TestClient(app, headers={"Authorization": "Bearer test-user"}) as client:
            self.assertEqual(client.post(path, json={**budget, "user_id": ENTRY_ID}).status_code, 422)
            self.assertEqual(client.post(path, json={**budget, "amount_minor": 1.5}).status_code, 422)
            self.assertEqual(client.post(path, json=budget).json(), saved)
            self.assertEqual(client.get(path).json(), [saved])
            self.assertEqual(client.delete(f"{path}/{ENTRY_ID}").status_code, 204)

    def test_api_uses_user_token_and_validates_writes(self):
        calls = []
        original_client = httpx.AsyncClient

        def database(request):
            calls.append(request)
            self.assertEqual(request.headers["authorization"], "Bearer test-user")
            self.assertEqual(request.headers["apikey"], "test-project")
            if request.url.path.endswith("sync_my_subscriptions"):
                return httpx.Response(404, json={"code": "PGRST202"})
            if request.method == "GET":
                result = [] if request.url.path.endswith("ledger_entries") else [{"monthStartDay": 25}]
                return httpx.Response(200, json=result)
            if request.url.path.endswith("ledger_preferences"):
                self.assertEqual(json.loads(request.content), {"monthStartDay": 26})
                return httpx.Response(201)
            if request.method == "DELETE":
                self.assertEqual(request.url.params["id"], f"eq.{ENTRY_ID}")
                return httpx.Response(204)
            payload = json.loads(request.content)
            self.assertNotIn("user_id", payload)
            self.assertEqual(payload["amountMinor"], -1250)
            return httpx.Response(201, json=[{"id": ENTRY_ID, **payload}])

        env = {"SUPABASE_URL": "https://project.example", "SUPABASE_PUBLISHABLE_KEY": "test-project"}
        with patch.dict(os.environ, env), patch("main.httpx.AsyncClient", side_effect=lambda **kw: original_client(
            **kw, transport=httpx.MockTransport(database)
        )), TestClient(app, headers={"Authorization": "Bearer test-user"}) as client:
            self.assertEqual(client.get("/v1/ledger").json(), {"entries": [], "monthStartDay": 25})
            self.assertEqual(client.post("/v1/transactions", json={**ENTRY, "user_id": ENTRY_ID}).status_code, 422)
            self.assertEqual(client.post("/v1/transactions", json={**ENTRY, "amountMinor": 0}).status_code, 422)
            self.assertEqual(client.post("/v1/transactions", json=ENTRY).json()["id"], ENTRY_ID)
            self.assertEqual(client.put("/v1/preferences", json={"monthStartDay": 26}).status_code, 200)
            self.assertEqual(client.delete(f"/v1/transactions/{ENTRY_ID}").status_code, 204)
            self.assertEqual(len(calls), 6)


if __name__ == "__main__":
    unittest.main()
