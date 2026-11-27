import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

from main import app

OWNER = "11111111-1111-4111-8111-111111111111"
OTHER = "22222222-2222-4222-8222-222222222222"
PHOTO = "33333333-3333-4333-8333-333333333333.jpg"
EMAIL = "person@example.test"
NOW = datetime.now(timezone.utc)
ENV = {"SUPABASE_URL": "https://project.example", "SUPABASE_PUBLISHABLE_KEY": "test-public",
       "SUPABASE_SECRET_KEY": "sb_secret_mock"}
CONFIRM = "/v1/account/reset/confirm"
REQUEST = "/v1/account/reset/request"


class AccountResetTest(unittest.TestCase):
    def test_reset_requires_a_signed_in_user(self):
        with TestClient(app) as client:
            self.assertEqual(client.post(REQUEST).status_code, 401)
            self.assertEqual(client.post(CONFIRM, json={"request_id": OTHER, "code": "123456"}).status_code, 401)

    def test_reset_verifies_code_before_deleting_and_retries_cleanup_safely(self):
        state = {}
        storage_deleted = []
        original_client = httpx.AsyncClient

        def supabase(request):
            path = request.url.path
            payload = json.loads(request.content) if request.content else {}
            if path == "/auth/v1/user":
                self.assertEqual(request.headers["authorization"], "Bearer account-session")
                return httpx.Response(200, json={"id": OWNER, "email": EMAIL, "email_confirmed_at": NOW.isoformat()})
            if path == "/auth/v1/otp":
                self.assertEqual(payload, {"email": EMAIL, "create_user": False})
                return httpx.Response(200, json={})
            if path == "/auth/v1/verify":
                self.assertEqual(payload["email"], EMAIL)
                if payload["token"] != "123456":
                    return httpx.Response(403)
                return httpx.Response(200, json={"user": {"id": OWNER}, "access_token": "temporary-otp-session"})
            if path == "/auth/v1/logout":
                self.assertEqual(request.headers["authorization"], "Bearer temporary-otp-session")
                self.assertEqual(request.url.params["scope"], "local")
                return httpx.Response(204)
            self.assertEqual(request.headers["apikey"], "sb_secret_mock")
            self.assertNotIn("authorization", request.headers)
            if path == "/rest/v1/account_reset_requests":
                if request.method == "POST":
                    self.assertEqual(payload["user_id"], OWNER)
                    state.update(payload)
                    return httpx.Response(201)
                self.assertEqual(request.url.params["user_id"], "eq." + OWNER)
                expected = "eq." + state["request_id"] if state else None
                return httpx.Response(200, json=[state] if request.url.params.get("request_id") == expected and state else [])
            if path == "/rest/v1/rpc/reset_oopsie_data":
                self.assertIsNone(state["completed_at"])
                self.assertEqual(payload, {"reset_owner": OWNER, "confirmation": state["request_id"]})
                state["completed_at"] = NOW.isoformat()
                return httpx.Response(200, json=state["completed_at"])
            if path == "/storage/v1/object/list/receipt-scan-feedback":
                self.assertEqual(payload["prefix"], OWNER)
                return httpx.Response(200, json=[
                    {"name": PHOTO, "created_at": NOW.isoformat()},
                    {"name": OTHER + ".png", "created_at": (NOW + timedelta(seconds=1)).isoformat()},
                ])
            self.assertEqual(path, "/storage/v1/object/receipt-scan-feedback")
            self.assertEqual(payload, {"prefixes": [OWNER + "/" + PHOTO]})
            storage_deleted.append(True)
            return httpx.Response(503 if len(storage_deleted) == 1 else 200, json=[])

        with patch.dict(os.environ, ENV), patch("main.httpx.AsyncClient", side_effect=lambda **kw: original_client(
            **kw, transport=httpx.MockTransport(supabase)
        )), TestClient(app, headers={"Authorization": "Bearer account-session"}) as client:
            result = client.post(REQUEST).json()
            self.assertEqual(result["email"], EMAIL)
            self.assertEqual(client.post(CONFIRM, json={"request_id": OTHER, "code": "123456"}).status_code, 409)
            confirmation = {"request_id": result["request_id"], "code": "999999"}
            self.assertEqual(client.post(CONFIRM, json=confirmation).status_code, 400)
            self.assertIsNone(state["completed_at"])
            self.assertEqual(storage_deleted, [])
            confirmation["code"] = "123456"
            self.assertEqual(client.post(CONFIRM, json=confirmation).status_code, 503)
            self.assertEqual(client.post(CONFIRM, json=confirmation).status_code, 204)
            self.assertEqual(len(storage_deleted), 2)
