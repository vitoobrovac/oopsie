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

    def test_hunt_username_uses_authenticated_rpc_and_reports_collisions(self):
        original_client = httpx.AsyncClient

        def database(request):
            self.assertTrue(request.url.path.endswith("/rpc/set_hunt_username"))
            self.assertEqual(request.headers["authorization"], "Bearer test-player")
            self.assertEqual(json.loads(request.content), {"requested_username": "hunt_player"})
            return httpx.Response(409, json={"code": "23505"})

        env = {"SUPABASE_URL": "https://project.example", "SUPABASE_PUBLISHABLE_KEY": "test-project"}
        with TestClient(app) as anonymous:
            self.assertEqual(anonymous.get("/v1/hunt/profile").status_code, 401)
            self.assertEqual(anonymous.get("/v1/hunt/lobby").status_code, 401)
        with patch.dict(os.environ, env), patch("main.httpx.AsyncClient", side_effect=lambda **kw: original_client(
            **kw, transport=httpx.MockTransport(database)
        )), TestClient(app, headers={"Authorization": "Bearer test-player"}) as client:
            invalid = client.put("/v1/hunt/profile", json={"username": "email@example.test"})
            self.assertEqual(invalid.status_code, 422)
            duplicate = client.put("/v1/hunt/profile", json={"username": "  Hunt_Player "})
            self.assertEqual(duplicate.status_code, 409)
            self.assertEqual(duplicate.json()["detail"], "That username is already taken.")

    def test_yearly_subscriptions_accept_annual_and_installment_schedules(self):
        from main import SubscriptionInput

        data = {"name": "Car registration", "amount_minor": 25001, "starts_on": "2026-12-01", "active": True}
        self.assertEqual(SubscriptionInput(**data, cadence="yearly").cadence, "yearly")
        self.assertEqual(SubscriptionInput(**data, cadence="yearly_split").amount_minor, 25001)
        with self.assertRaises(ValueError):
            SubscriptionInput(**{**data, "amount_minor": 11}, cadence="yearly_split")

    def test_hunt_claim_uses_player_token_and_database_eligibility(self):
        original_client = httpx.AsyncClient
        path = "/v1/hunt/achievements"
        payload = {"challenge_id": "receipt_days", "tier": 2}

        def database(request):
            self.assertEqual(request.headers["authorization"], "Bearer test-player")
            if request.method == "GET":
                self.assertTrue(request.url.path.endswith("/rpc/get_hunt_achievements"))
                return httpx.Response(200, json={"challenges": []})
            self.assertTrue(request.url.path.endswith("/rpc/claim_hunt_achievement"))
            self.assertEqual(json.loads(request.content), {"challenge_id": "receipt_days", "requested_tier": 2})
            return httpx.Response(400, json={"code": "22023"})

        env = {"SUPABASE_URL": "https://project.example", "SUPABASE_PUBLISHABLE_KEY": "test-project"}
        with TestClient(app) as anonymous:
            self.assertEqual(anonymous.get(path).status_code, 401)
            self.assertEqual(anonymous.post(path + "/claim", json=payload).status_code, 401)
        with patch.dict(os.environ, env), patch("main.httpx.AsyncClient", side_effect=lambda **kw: original_client(
            **kw, transport=httpx.MockTransport(database)
        )), TestClient(app, headers={"Authorization": "Bearer test-player"}) as client:
            self.assertEqual(client.get(path).json(), {"challenges": []})
            self.assertEqual(client.post(path + "/claim", json={**payload, "xp": 9999}).status_code, 422)
            self.assertEqual(client.post(path + "/claim", json=payload).status_code, 409)

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
            if request.url.path.endswith(("sync_my_subscriptions", "sync_my_recurring_income", "sync_my_ledger_schedules")):
                return httpx.Response(404, json={"code": "PGRST202"})
            if request.url.path.endswith("goal_allocations"):
                return httpx.Response(404, json={"code": "PGRST205"})
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
            self.assertEqual(len(calls), 9)

    def test_fund_bill_uses_session_and_validates_positive_amount(self):
        original_client = httpx.AsyncClient
        payload = {"entry_id": ENTRY_ID, "description": "Car registration", "category": "Transport", "amount_minor": 8500}

        def database(request):
            self.assertEqual(request.headers["authorization"], "Bearer test-user")
            self.assertTrue(request.url.path.endswith("/rpc/record_fund_bill"))
            self.assertEqual(json.loads(request.content), {
                "fund_id": ENTRY_ID, "entry_id": ENTRY_ID, "description": "Car registration",
                "expense_category": "Transport", "bill_amount": 8500,
            })
            return httpx.Response(204)

        env = {"SUPABASE_URL": "https://project.example", "SUPABASE_PUBLISHABLE_KEY": "test-project"}
        with patch.dict(os.environ, env), patch("main.httpx.AsyncClient", side_effect=lambda **kw: original_client(
            **kw, transport=httpx.MockTransport(database)
        )), TestClient(app, headers={"Authorization": "Bearer test-user"}) as client:
            path = f"/v1/bill-funds/{ENTRY_ID}/record-bill"
            self.assertEqual(client.post(path, json={**payload, "amount_minor": 0}).status_code, 422)
            self.assertEqual(client.post(path, json=payload).status_code, 204)

    def test_goal_allocation_uses_owner_session_and_reports_changed_balance(self):
        original_client = httpx.AsyncClient
        payload = {"allocation_id": ENTRY_ID, "period": "week",
                   "contributions": [{"goal_id": ENTRY_ID, "amount_minor": 2500}]}

        def database(request):
            self.assertEqual(request.headers["authorization"], "Bearer test-user")
            self.assertTrue(request.url.path.endswith("/rpc/allocate_to_goals"))
            self.assertEqual(json.loads(request.content), payload)
            return httpx.Response(400, json={"code": "22023"})

        env = {"SUPABASE_URL": "https://project.example", "SUPABASE_PUBLISHABLE_KEY": "test-project"}
        with patch.dict(os.environ, env), patch("main.httpx.AsyncClient", side_effect=lambda **kw: original_client(
            **kw, transport=httpx.MockTransport(database)
        )), TestClient(app, headers={"Authorization": "Bearer test-user"}) as client:
            self.assertEqual(client.post("/v1/goals/allocate", json={**payload, "period": "anything"}).status_code, 422)
            self.assertEqual(client.post("/v1/goals/allocate", json={**payload, "user_id": ENTRY_ID}).status_code, 422)
            self.assertEqual(client.post("/v1/goals/allocate", json=payload).status_code, 409)

    def test_recurring_income_preserves_owner_token_and_validates_repeat(self):
        original_client = httpx.AsyncClient
        payload = {"name": "Salary", "amount_minor": 255000, "starts_on": "2026-12-01",
                   "cadence": "monthly", "category": "Salary", "merchant": "Employer"}
        saved = {"id": ENTRY_ID, "next_due": "2026-12-01", **payload}

        def database(request):
            self.assertEqual(request.headers["authorization"], "Bearer test-user")
            if request.url.path.endswith("/rpc/sync_my_recurring_income"):
                return httpx.Response(204)
            self.assertTrue(request.url.path.endswith("/recurring_income"))
            if request.method == "POST":
                self.assertEqual(json.loads(request.content), payload)
                return httpx.Response(201, json=[saved])
            if request.method == "DELETE":
                self.assertEqual(request.url.params["id"], "eq." + ENTRY_ID)
                return httpx.Response(204)
            return httpx.Response(200, json=[saved])

        env = {"SUPABASE_URL": "https://project.example", "SUPABASE_PUBLISHABLE_KEY": "test-project"}
        with patch.dict(os.environ, env), patch("main.httpx.AsyncClient", side_effect=lambda **kw: original_client(
            **kw, transport=httpx.MockTransport(database)
        )), TestClient(app, headers={"Authorization": "Bearer test-user"}) as client:
            path = "/v1/recurring-income"
            self.assertEqual(client.post(path, json={**payload, "cadence": "yearly_split"}).status_code, 422)
            self.assertEqual(client.post(path, json={**payload, "amount_minor": -2500}).status_code, 422)
            self.assertEqual(client.post(path, json={**payload, "user_id": ENTRY_ID}).status_code, 422)
            self.assertEqual(client.post(path, json=payload).json(), saved)
            self.assertEqual(client.get(path).json(), [saved])
            self.assertEqual(client.delete(f"{path}/{ENTRY_ID}").status_code, 204)


if __name__ == "__main__":
    unittest.main()
