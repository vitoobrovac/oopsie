"""Confirm account resets through Supabase Auth and remove owner-scoped data."""

import os
import re
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import httpx
from fastapi import HTTPException

BUCKET = "receipt-scan-feedback"
PHOTO_NAME = re.compile(r"[0-9a-f-]{36}\.(?:jpg|png|webp)")


def reset_service(client: httpx.AsyncClient):
    key = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise HTTPException(503, "Account reset email is not configured yet.")
    headers = {"apikey": key}
    if key.startswith("eyJ"):
        headers["Authorization"] = "Bearer " + key
    return httpx.AsyncClient(base_url=client.base_url.join("/"), headers=headers, timeout=12)


async def send(client, method, path, **kwargs):
    try:
        return await client.request(method, path, **kwargs)
    except httpx.RequestError as error:
        raise HTTPException(503, "The account service is unavailable. Try again.") from error


async def reset_user(client):
    response = await send(client, "GET", str(client.base_url.join("/auth/v1/user")))
    if response.status_code in (401, 403):
        raise HTTPException(401, "Sign in again to reset your data.")
    if response.is_error:
        raise HTTPException(503, "Could not verify your account. Try again.")
    user = response.json()
    if not user.get("email") or not user.get("email_confirmed_at"):
        raise HTTPException(409, "Verify your account email before requesting a reset.")
    return str(UUID(user["id"])), user["email"]


async def request_reset(client):
    owner, email = await reset_user(client)
    request_id = str(uuid4())
    expires = datetime.now(timezone.utc) + timedelta(minutes=15)
    async with reset_service(client) as service:
        existing = await send(service, "GET", "/rest/v1/account_reset_requests", params={
            "select": "request_id", "user_id": "eq." + owner, "limit": 1,
        })
        if existing.is_error:
            raise HTTPException(503, "Account reset needs migration 014 and a server-side Supabase key.")
        result = await send(client, "POST", str(client.base_url.join("/auth/v1/otp")),
                            json={"email": email, "create_user": False})
        if result.status_code == 429:
            raise HTTPException(429, "Wait a minute before requesting another code.")
        if result.is_error:
            raise HTTPException(503, "Could not send the reset email. Check the email setup or try again.")
        pending = await send(service, "POST", "/rest/v1/account_reset_requests", params={"on_conflict": "user_id"},
                             headers={"Prefer": "resolution=merge-duplicates"}, json={
                                 "user_id": owner, "email": email, "request_id": request_id,
                                 "expires_at": expires.isoformat(), "completed_at": None,
                             })
        if pending.is_error:
            raise HTTPException(503, "Account reset needs migration 014 and a server-side Supabase key.")
    return {"request_id": request_id, "email": email}


async def remove_feedback(service, owner, reset_at):
    paths = []
    offset = 0
    while True:
        response = await send(service, "POST", "/storage/v1/object/list/" + BUCKET,
                              json={"prefix": owner, "limit": 100, "offset": offset,
                                    "sortBy": {"column": "name", "order": "asc"}})
        if response.is_error:
            raise HTTPException(503, "Could not remove submitted receipt photos. Retry this reset.")
        rows = response.json()
        for row in rows:
            if PHOTO_NAME.fullmatch(row["name"]) and row.get("created_at"):
                if datetime.fromisoformat(row["created_at"]) <= reset_at:
                    paths.append(owner + "/" + row["name"])
        if len(rows) < 100:
            break
        offset += len(rows)
    for index in range(0, len(paths), 100):
        response = await send(service, "DELETE", "/storage/v1/object/" + BUCKET,
                              json={"prefixes": paths[index:index + 100]})
        if response.is_error:
            raise HTTPException(503, "Could not remove submitted receipt photos. Retry this reset.")


async def confirm_reset(client, request_id: UUID, code: str):
    owner, email = await reset_user(client)
    async with reset_service(client) as service:
        pending = await send(service, "GET", "/rest/v1/account_reset_requests", params={
            "user_id": "eq." + owner, "request_id": "eq." + str(request_id),
            "select": "email,expires_at,completed_at",
        })
        if pending.is_error:
            raise HTTPException(503, "Could not verify your reset request. Try again.")
        records = pending.json()
        record = records[0] if records else None
        if not record or record["email"] != email or datetime.fromisoformat(record["expires_at"]) <= datetime.now(timezone.utc):
            raise HTTPException(409, "This reset request expired. Request a new code.")

        if record["completed_at"] is None:
            verified = await send(client, "POST", str(client.base_url.join("/auth/v1/verify")),
                                  json={"email": email, "token": code, "type": "email"})
            if verified.status_code == 429:
                raise HTTPException(429, "Too many attempts. Wait before trying again.")
            if verified.status_code in (400, 401, 403, 422):
                raise HTTPException(400, "That code is incorrect or expired.")
            if verified.is_error:
                raise HTTPException(503, "Could not verify the code. Try again.")
            proof = verified.json()
            if proof.get("user", {}).get("id") != owner or not proof.get("access_token"):
                raise HTTPException(403, "The code did not verify this account.")
            # Email verification creates a secondary Auth session. Keep the user's original session.
            try:
                await send(client, "POST", str(client.base_url.join("/auth/v1/logout")), params={"scope": "local"},
                           headers={"Authorization": "Bearer " + proof["access_token"]})
            except HTTPException:
                pass
            result = await send(service, "POST", "/rest/v1/rpc/reset_oopsie_data",
                                json={"reset_owner": owner, "confirmation": str(request_id)})
            if result.is_error:
                raise HTTPException(503, "Could not reset your data. Request a fresh code and try again.")
            reset_at = datetime.fromisoformat(result.json())
        else:
            reset_at = datetime.fromisoformat(record["completed_at"])
        await remove_feedback(service, owner, reset_at)
