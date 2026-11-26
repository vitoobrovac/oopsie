"""Private ledger API. Supabase verifies the user token and enforces row ownership."""

import os
import asyncio
from datetime import date as Date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ValidationError, ConfigDict, Field, StringConstraints, field_validator, model_validator

from exchange_rates import Currency, RateUnavailable, convert_receipt, latest_rate
from receipt_pipeline import analyze

app = FastAPI(title="oopsie ledger API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip().rstrip("/")
        for origin in os.environ.get("LUMA_WEB_ORIGIN", "http://localhost:3000").split(",")
        if origin.strip()
    ],
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
bearer = HTTPBearer(auto_error=False)
Credentials = Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
PAGE_SIZE = 200
MAX_PHOTO = 10 * 1024 * 1024
ocr_lock = asyncio.Lock()


class EntryInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    date: Date = Field(ge=Date(1900, 1, 1))
    name: Text
    category: str = Field(min_length=1, max_length=40)
    merchant: str = Field(default="", max_length=120)
    amountMinor: int = Field(strict=True, ge=-99999999999, le=99999999999)

    @field_validator("amountMinor")
    @classmethod
    def reject_zero(cls, value: int) -> int:
        if value == 0:
            raise ValueError("Amount must not be zero.")
        return value


PositiveMinor = Annotated[int, Field(strict=True, ge=1, le=99999999999)]


class PlanningInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    amount_minor: PositiveMinor


class BudgetInput(PlanningInput):
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class GoalInput(PlanningInput):
    name: Text
    saved_minor: int = Field(strict=True, ge=0, le=99999999999)


class SubscriptionInput(PlanningInput):
    name: Text
    starts_on: Date = Field(ge=Date(1900, 1, 1), le=Date(9999, 1, 1))
    cadence: Literal["weekly", "monthly", "yearly", "yearly_split"]
    active: bool

    @model_validator(mode="after")
    def validate_installments(self):
        if self.cadence == "yearly_split" and self.amount_minor < 12:
            raise ValueError("The yearly amount must be at least €0.12 to split it into 12 monthly entries.")
        return self


Plan = Literal["budgets", "goals", "subscriptions"]
PLANNING = {
    "budgets": ("budgets", "id,category,amount_minor", BudgetInput),
    "goals": ("savings_goals", "id,name,amount_minor,saved_minor", GoalInput),
    "subscriptions": ("subscriptions", "id,name,amount_minor,starts_on,cadence,active,next_due", SubscriptionInput),
}


class HuntUsername(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-z0-9_]+$")

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class Preferences(BaseModel):
    model_config = ConfigDict(extra="forbid")
    monthStartDay: int = Field(strict=True, ge=1, le=31)


Alias = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class ReceiptLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["product", "discount", "deposit"]
    receipt_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
    display_name: Text
    category: str = Field(default="", max_length=60)
    aliases: list[Alias] = Field(default_factory=list, max_length=20)
    quantity: Decimal | None = Field(default=None, gt=0, le=1000000, decimal_places=3)
    unit: Literal["unit", "kg", "L"]
    amount_minor: int = Field(strict=True, ge=-99999999999, le=99999999999)
    remember: bool = False


class ReceiptInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    store: Text
    date: Date = Field(ge=Date(1900, 1, 1))
    currency: Currency
    rate_date: Date | None = None
    total_minor: int = Field(strict=True, ge=1, le=99999999999)
    lines: list[ReceiptLine] = Field(min_length=1, max_length=300)

    @model_validator(mode="after")
    def reconcile(self):
        if not any(line.kind == "product" for line in self.lines):
            raise ValueError("Add at least one product.")
        if any((line.amount_minor < 0) != (line.kind == "discount") for line in self.lines):
            raise ValueError("Only discounts can have a negative price.")
        if sum(line.amount_minor for line in self.lines) != self.total_minor:
            raise ValueError("The receipt total must equal the sum of its lines.")
        return self


async def database(credentials: Credentials):
    if credentials is None:
        raise HTTPException(401, "Sign in to continue.")
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_PUBLISHABLE_KEY")
    if not url or not key:
        raise HTTPException(503, "The database is not configured.")
    async with httpx.AsyncClient(
        base_url=url.rstrip("/") + "/rest/v1/",
        headers={"apikey": key, "Authorization": f"Bearer {credentials.credentials}"},
        timeout=10,
    ) as client:
        yield client


Database = Annotated[httpx.AsyncClient, Depends(database)]


async def request(client: httpx.AsyncClient, method: str, path: str, *, allow_missing=False, **kwargs):
    try:
        response = await client.request(method, path, **kwargs)
    except httpx.RequestError as exc:
        raise HTTPException(503, "The database is unavailable.") from exc
    if response.status_code in (401, 403):
        raise HTTPException(response.status_code, "Your session cannot access this data.")
    if response.is_error:
        try:
            code = response.json().get("code")
        except (ValueError, AttributeError):
            code = None
        if code in {"PGRST202", "PGRST205", "42P01"}:
            if allow_missing:
                return None
            if path in {"rpc/get_hunt_profile", "rpc/set_hunt_username", "rpc/get_hunt_lobby"}:
                raise HTTPException(503, "Oopsie Hunt needs migration 007 in Supabase.")
            if path in {"budgets", "savings_goals", "subscriptions", "rpc/sync_my_subscriptions"}:
                raise HTTPException(503, "Planning needs the private planning migration in your development database.")
            raise HTTPException(503, "Receipt tables are missing. Apply the receipt migration in Supabase.")
        if code == "23514" and path == "subscriptions" and kwargs.get("json", {}).get("cadence") in {"yearly", "yearly_split"}:
            raise HTTPException(503, "Apply migration 004 in Supabase to enable yearly subscriptions.")
        if code == "23505" and path == "rpc/set_hunt_username":
            raise HTTPException(409, "That username is already taken.")
        if code == "23505" and path == "budgets":
            raise HTTPException(409, "A budget already exists for this category.")
        raise HTTPException(502, "The database could not complete this request.")
    return response.json() if response.content else None


async def ledger_entries(client: httpx.AsyncClient):
    await request(client, "POST", "rpc/sync_my_subscriptions", json={}, allow_missing=True)
    entries = []
    while True:
        page = await request(client, "GET", "ledger_entries", params={
            "select": "id,date,name,category,merchant,amountMinor",
            "order": "date.desc,id.asc", "limit": PAGE_SIZE, "offset": len(entries),
        })
        entries.extend(page)
        if len(page) < PAGE_SIZE:
            break
    return entries


@app.get("/v1/hunt/profile")
async def get_hunt_profile(client: Database):
    return await request(client, "GET", "rpc/get_hunt_profile")


@app.put("/v1/hunt/profile")
async def change_hunt_username(profile: HuntUsername, client: Database):
    return await request(client, "POST", "rpc/set_hunt_username", json={"requested_username": profile.username})


@app.get("/v1/hunt/lobby")
async def get_hunt_lobby(client: Database):
    return await request(client, "GET", "rpc/get_hunt_lobby")


@app.get("/v1/ledger")
async def list_ledger(client: Database):
    entries, preferences = await asyncio.gather(
        ledger_entries(client),
        request(client, "GET", "ledger_preferences", params={"select": "monthStartDay"}),
    )
    return {"entries": entries, "monthStartDay": preferences[0]["monthStartDay"] if preferences else 1}


@app.post("/v1/transactions", status_code=201)
async def create_entry(entry: EntryInput, client: Database):
    rows = await request(client, "POST", "ledger_entries", json=entry.model_dump(mode="json"),
                         params={"select": "id,date,name,category,merchant,amountMinor"},
                         headers={"Prefer": "return=representation"})
    return rows[0]


@app.delete("/v1/transactions/{entry_id}", status_code=204)
async def delete_entry(entry_id: UUID, client: Database):
    await request(client, "DELETE", "ledger_entries", params={"id": f"eq.{entry_id}"})
    return Response(status_code=204)


@app.put("/v1/preferences")
async def save_preferences(preferences: Preferences, client: Database):
    await request(client, "POST", "ledger_preferences", params={"on_conflict": "user_id"},
                  json=preferences.model_dump(), headers={"Prefer": "resolution=merge-duplicates"})
    return preferences


@app.get("/v1/planning/{plan}")
async def list_planning(plan: Plan, client: Database):
    table, fields, _ = PLANNING[plan]
    if plan == "subscriptions":
        await request(client, "POST", "rpc/sync_my_subscriptions", json={})
    rows = []
    while True:
        page = await request(client, "GET", table, params={
            "select": fields, "order": "id.asc", "limit": PAGE_SIZE, "offset": len(rows),
        })
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows


async def write_plan(plan: Plan, payload: dict, client: Database, entry_id: UUID | None = None):
    table, fields, model = PLANNING[plan]
    try:
        value = model.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(422, "Check the planning fields and try again.") from exc
    if plan == "subscriptions" and entry_id is not None:
        await request(client, "POST", "rpc/sync_my_subscriptions", json={})
    params = {"select": fields}
    if entry_id is not None:
        params["id"] = f"eq.{entry_id}"
    rows = await request(client, "POST" if entry_id is None else "PATCH", table, params=params,
                         json=value.model_dump(mode="json"), headers={"Prefer": "return=representation"})
    if not rows:
        raise HTTPException(404, "This record no longer exists.")
    return rows[0]


@app.post("/v1/planning/{plan}", status_code=201)
async def create_plan(plan: Plan, payload: dict, client: Database):
    return await write_plan(plan, payload, client)


@app.put("/v1/planning/{plan}/{entry_id}")
async def update_plan(plan: Plan, entry_id: UUID, payload: dict, client: Database):
    return await write_plan(plan, payload, client, entry_id)


@app.delete("/v1/planning/{plan}/{entry_id}", status_code=204)
async def delete_plan(plan: Plan, entry_id: UUID, client: Database):
    table, _, _ = PLANNING[plan]
    if plan == "subscriptions":
        await request(client, "POST", "rpc/sync_my_subscriptions", json={})
    await request(client, "DELETE", table, params={"id": f"eq.{entry_id}"})
    return Response(status_code=204)


def receipt_key(text: str) -> str:
    return " ".join(text.lower().split())


@app.post("/v1/receipts/analyze")
async def analyze_receipt(photo: Request, client: Database):
    user = await request(client, "GET", str(client.base_url.join("/auth/v1/user")))
    if not isinstance(user, dict) or not user.get("id"):
        raise HTTPException(401, "Sign in to analyze receipts.")
    if photo.headers.get("content-type", "").split(";")[0] not in {
        "image/jpeg", "image/png", "image/webp", "application/octet-stream"
    }:
        raise HTTPException(415, "Choose a JPEG, PNG, or WebP photo.")
    image = bytearray()
    async for chunk in photo.stream():
        if len(image) + len(chunk) > MAX_PHOTO:
            raise HTTPException(413, "The photo must be under 10 MB.")
        image.extend(chunk)
    if not image:
        raise HTTPException(400, "Choose a photo to scan.")
    if ocr_lock.locked():
        raise HTTPException(429, "The scanner is busy. Try again in a moment.")
    async with ocr_lock:
        try:
            draft = await run_in_threadpool(analyze, bytes(image))
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(503, "The scanner is unavailable. You can enter the receipt manually.") from exc
    if draft["store"] and draft["lines"]:
        labels = await request(client, "GET", "receipt_product_labels", params={
            "select": "receipt_key,display_name,category",
            "store_key": "eq." + receipt_key(draft["store"]),
        })
        known = {row["receipt_key"]: row for row in labels}
        for line in draft["lines"]:
            saved = known.get(receipt_key(line["receipt_name"])) if line["kind"] == "product" else None
            if saved:
                line.update(display_name=saved["display_name"], category=saved["category"], review=False)
    return draft


@app.get("/v1/receipts")
async def list_receipts(client: Database):
    receipts = []
    while True:
        batch = await request(client, "GET", "receipts", params={
            "select": "id,store,purchased_on,currency,total_minor,lines:receipt_lines(position,kind,receipt_name,display_name,category,aliases,quantity,unit,amount_minor)",
            "order": "purchased_on.desc,id.desc", "lines.order": "position.asc",
            "limit": 30, "offset": len(receipts),
        })
        receipts.extend(batch)
        if len(batch) < 30:
            return receipts


async def receipt_rate(currency: Currency):
    try:
        return await latest_rate(currency)
    except RateUnavailable as exc:
        raise HTTPException(503, "The exchange rate is temporarily unavailable. Try again shortly.") from exc


@app.get("/v1/receipts/exchange-rate")
async def get_receipt_rate(currency: Currency, credentials: Credentials):
    if credentials is None:
        raise HTTPException(401, "Sign in to continue.")
    if currency == "EUR":
        raise HTTPException(422, "EUR receipts do not need conversion.")
    quote = await receipt_rate(currency)
    return {"rate_date": quote.published_on, "units_per_eur": format(quote.units_per_eur, "f")}


@app.post("/v1/receipts", status_code=201)
async def save_receipt(receipt: ReceiptInput, client: Database):
    total = receipt.total_minor
    lines = [line.model_dump(mode="json") for line in receipt.lines]
    if receipt.currency != "EUR":
        quote = await receipt_rate(receipt.currency)
        if receipt.rate_date != quote.published_on:
            raise HTTPException(409, "Refresh the exchange rate and check the new EUR total before saving.")
        try:
            total, amounts = convert_receipt([line.amount_minor for line in receipt.lines], quote.units_per_eur)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        if not 0 < total <= 99999999999 or any(abs(amount) > 99999999999 for amount in amounts):
            raise HTTPException(422, "The converted amount is outside the supported EUR range.")
        for line, amount in zip(lines, amounts, strict=True):
            line["amount_minor"] = amount

    receipt_id = await request(client, "POST", "rpc/save_receipt", json={
        "receipt_id": str(receipt.id), "merchant": receipt.store, "receipt_date": receipt.date.isoformat(),
        "total": total, "lines": lines,
    })
    return {"id": receipt_id}
