"""Private ledger API. Supabase verifies the user token and enforces row ownership."""

import os
import json
import asyncio
from datetime import date as Date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ValidationError, ConfigDict, Field, StringConstraints, field_validator, model_validator

from exchange_rates import Currency, RateUnavailable, convert_receipt, latest_rate
from account_reset import confirm_reset, request_reset
from receipt_pipeline import ReceiptRecognitionError, analyze
from receipt_categories import EXPENSE_CATEGORIES, receipt_category

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
    priority: Literal["low", "normal", "high"] | None = None
    reset_period: Literal["weekly", "monthly", "yearly", "once"] | None = None
    starts_on: Date | None = None

    @model_validator(mode="after")
    def validate_start(self):
        if self.reset_period == "once" and self.starts_on is None:
            raise ValueError("A one-time budget needs a start date.")
        return self


class GoalInput(PlanningInput):
    name: Text
    saved_minor: int = Field(strict=True, ge=0, le=99999999999)
    priority: Literal["low", "normal", "high"] | None = None


class BillFundInput(GoalInput):
    fund_cadence: Literal["weekly", "monthly"]
    fund_amount_minor: PositiveMinor
    fund_starts_on: Date = Field(ge=Date(1900, 1, 1), le=Date(9999, 1, 1))
    fund_active: bool


class FundBillInput(PlanningInput):
    entry_id: UUID
    description: Text
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


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


class RecurringIncomeInput(PlanningInput):
    name: Text
    category: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    merchant: Annotated[str, StringConstraints(strip_whitespace=True, max_length=120)] = ""
    starts_on: Date = Field(ge=Date(1900, 1, 1), le=Date(9999, 1, 1))
    cadence: Literal["weekly", "monthly", "yearly"]


class GoalContribution(PlanningInput):
    goal_id: UUID


class GoalAllocationInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allocation_id: UUID
    period: Literal["week", "month", "year"]
    contributions: list[GoalContribution] = Field(min_length=1, max_length=100)


Plan = Literal["budgets", "goals", "subscriptions", "bill-funds"]
PLANNING_SCHEMA_MESSAGE = "Apply the latest Supabase migrations to use these planning fields."
PLANNING = {
    "budgets": ("budgets", "id,category,amount_minor", BudgetInput),
    "goals": ("savings_goals", "id,name,amount_minor,saved_minor", GoalInput),
    "subscriptions": ("subscriptions", "id,name,amount_minor,starts_on,cadence,active,next_due", SubscriptionInput),
    "bill-funds": ("savings_goals", "id,name,amount_minor,saved_minor,priority,fund_cadence,fund_amount_minor,fund_starts_on,fund_next_due,fund_active", BillFundInput),
}


class HuntUsername(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=3, max_length=20, pattern=r"^[a-z0-9_]+$")

    @field_validator("username", mode="before")
    @classmethod
    def normalize_username(cls, value):
        return value.strip().lower() if isinstance(value, str) else value


class HuntClaim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    challenge_id: str = Field(pattern=r"^[a-z_]{1,40}$")
    tier: int = Field(strict=True, ge=1, le=3)


class HuntJoin(BaseModel):
    model_config = ConfigDict(extra="forbid")
    starts_on: Date


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
    spending_category: str | None = None
    total_minor: int = Field(strict=True, ge=1, le=99999999999)
    lines: list[ReceiptLine] = Field(min_length=1, max_length=300)

    @field_validator("spending_category")
    @classmethod
    def validate_spending_category(cls, value):
        if value is not None and value not in EXPENSE_CATEGORIES:
            raise ValueError("Choose a supported spending category.")
        return value

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


class ResetConfirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    code: Annotated[str, StringConstraints(pattern=r"^[0-9]{6,10}$")]


@app.post("/v1/account/reset/request")
async def send_account_reset(client: Database):
    return await request_reset(client)


@app.post("/v1/account/reset/confirm", status_code=204)
async def reset_account(confirmation: ResetConfirmation, client: Database):
    await confirm_reset(client, confirmation.request_id, confirmation.code)
    return Response(status_code=204)


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
        if path in {"budgets", "savings_goals"} and code in {"42703", "PGRST204"}:
            raise HTTPException(503, PLANNING_SCHEMA_MESSAGE)
        if code in {"PGRST202", "PGRST205", "42P01"}:
            if allow_missing:
                return None
            if path in {"rpc/get_hunt_profile", "rpc/set_hunt_username", "rpc/get_hunt_lobby"}:
                raise HTTPException(503, "Oopsie Hunt needs migration 007 in Supabase.")
            if path in {"rpc/get_hunt_achievements", "rpc/claim_hunt_achievement"}:
                raise HTTPException(503, "Permanent Hunt challenges need migration 008 in Supabase.")
            if path in {"rpc/join_current_hunt", "rpc/get_hunt_reward_count"}:
                raise HTTPException(503, "Hunt participation and notifications need migration 010 in Supabase.")
            if path in {"budgets", "savings_goals", "subscriptions", "rpc/sync_my_subscriptions"}:
                raise HTTPException(503, "Planning needs the private planning migration in your development database.")
            if path in {"recurring_income", "rpc/sync_my_recurring_income"}:
                raise HTTPException(503, "Recurring income needs migration 013 in Supabase.")
            if path in {"goal_allocations", "rpc/allocate_to_goals"}:
                raise HTTPException(503, "Goal savings need migration 015 in Supabase.")
            if path == "rpc/record_fund_bill":
                raise HTTPException(503, "Bill funds need migration 017 in Supabase.")
            raise HTTPException(503, "Receipt tables are missing. Apply the receipt migration in Supabase.")
        if code == "23514" and path == "subscriptions" and kwargs.get("json", {}).get("cadence") in {"yearly", "yearly_split"}:
            raise HTTPException(503, "Apply migration 004 in Supabase to enable yearly subscriptions.")
        if code == "23505" and path == "rpc/set_hunt_username":
            raise HTTPException(409, "That username is already taken.")
        if code == "22023" and path == "rpc/claim_hunt_achievement":
            raise HTTPException(409, "This tier is not ready to claim.")
        if code == "22023" and path == "rpc/join_current_hunt":
            raise HTTPException(409, "This hunt week has ended or is unavailable. Refresh the Hunt.")
        if code == "23505" and path == "budgets":
            raise HTTPException(409, "A budget already exists for this category.")
        if code == "22023" and path == "rpc/allocate_to_goals":
            raise HTTPException(409, "The available balance or goal amounts changed. Check your plan and try again.")
        if code == "22023" and path == "rpc/record_fund_bill":
            raise HTTPException(409, "This fund is no longer available or has no money left to use.")
        raise HTTPException(502, "The database could not complete this request.")
    return response.json() if response.content else None


async def sync_ledger_schedules(client: httpx.AsyncClient):
    if await request(client, "POST", "rpc/sync_my_ledger_schedules", json={}, allow_missing=True) is None:
        await asyncio.gather(
            request(client, "POST", "rpc/sync_my_subscriptions", json={}, allow_missing=True),
            request(client, "POST", "rpc/sync_my_recurring_income", json={}, allow_missing=True),
        )


async def ledger_entries(client: httpx.AsyncClient):
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


@app.get("/v1/hunt/achievements")
async def get_hunt_achievements(client: Database):
    return await request(client, "GET", "rpc/get_hunt_achievements")


@app.post("/v1/hunt/achievements/claim")
async def claim_hunt_achievement(claim: HuntClaim, client: Database):
    return await request(client, "POST", "rpc/claim_hunt_achievement",
                         json={"challenge_id": claim.challenge_id, "requested_tier": claim.tier})


@app.get("/v1/hunt/rewards")
async def get_hunt_reward_count(client: Database):
    return await request(client, "GET", "rpc/get_hunt_reward_count")


@app.post("/v1/hunt/join")
async def join_current_hunt(join: HuntJoin, client: Database):
    return await request(client, "POST", "rpc/join_current_hunt", json={"expected_week": join.starts_on.isoformat()})


@app.get("/v1/ledger")
async def list_ledger(client: Database):
    await sync_ledger_schedules(client)
    entries, preferences, allocations = await asyncio.gather(
        ledger_entries(client),
        request(client, "GET", "ledger_preferences", params={"select": "monthStartDay"}),
        list_goal_allocations(client),
    )
    data = {"entries": entries, "monthStartDay": preferences[0]["monthStartDay"] if preferences else 1}
    if allocations is not None:
        data["goalAllocations"] = allocations
    return data


async def list_goal_allocations(client: httpx.AsyncClient):
    allocations = []
    while True:
        page = await request(client, "GET", "goal_allocations", allow_missing=True, params={
            "select": "goal_id,allocated_on,amount_minor", "order": "allocated_on.desc,request_id,goal_id",
            "limit": PAGE_SIZE, "offset": len(allocations),
        })
        if page is None:
            return None
        allocations.extend(page)
        if len(page) < PAGE_SIZE:
            return allocations


@app.post("/v1/goals/allocate", status_code=204)
async def allocate_goals(allocation: GoalAllocationInput, client: Database):
    await request(client, "POST", "rpc/allocate_to_goals", json=allocation.model_dump(mode="json"))
    return Response(status_code=204)


@app.post("/v1/bill-funds/{fund_id}/record-bill", status_code=204)
async def record_fund_bill(fund_id: UUID, bill: FundBillInput, client: Database):
    await request(client, "POST", "rpc/record_fund_bill", json={
        "fund_id": str(fund_id), "entry_id": str(bill.entry_id), "bill_amount": bill.amount_minor,
        "description": bill.description, "expense_category": bill.category,
    })
    return Response(status_code=204)


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


INCOME_FIELDS = "id,name,category,merchant,amount_minor,starts_on,cadence,next_due"


@app.get("/v1/recurring-income")
async def list_recurring_income(client: Database):
    await request(client, "POST", "rpc/sync_my_recurring_income", json={})
    schedules = []
    while True:
        rows = await request(client, "GET", "recurring_income", params={
            "select": INCOME_FIELDS, "order": "next_due.asc,id.asc", "limit": PAGE_SIZE, "offset": len(schedules),
        })
        schedules.extend(rows)
        if len(rows) < PAGE_SIZE:
            return schedules


@app.post("/v1/recurring-income", status_code=201)
async def create_recurring_income(income: RecurringIncomeInput, client: Database):
    rows = await request(client, "POST", "recurring_income", json=income.model_dump(mode="json"),
                         params={"select": INCOME_FIELDS}, headers={"Prefer": "return=representation"})
    return rows[0]


@app.delete("/v1/recurring-income/{income_id}", status_code=204)
async def stop_recurring_income(income_id: UUID, client: Database):
    await request(client, "POST", "rpc/sync_my_recurring_income", json={})
    await request(client, "DELETE", "recurring_income", params={"id": f"eq.{income_id}"})
    return Response(status_code=204)


@app.get("/v1/planning/{plan}")
async def list_planning(plan: Plan, client: Database):
    table, fields, _ = PLANNING[plan]
    if plan == "subscriptions":
        await request(client, "POST", "rpc/sync_my_subscriptions", json={})
    elif plan == "bill-funds":
        await sync_ledger_schedules(client)
    rows = []
    selections = iter(planning_selections(plan, fields))
    select = next(selections)
    while True:
        params = {"select": select, "order": "id.asc", "limit": PAGE_SIZE, "offset": len(rows)}
        if plan == "bill-funds":
            params["fund_cadence"] = "not.is.null"
        try:
            page = await request(client, "GET", table, params=params)
        except HTTPException as error:
            fallback = next(selections, None)
            if fallback is None or error.detail != PLANNING_SCHEMA_MESSAGE:
                raise
            select = fallback
            continue
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows


def planning_selections(plan: Plan, fields: str, *, reading=True):
    if plan == "budgets":
        return (fields + ",priority,reset_period,starts_on", fields + ",priority", fields)
    if plan == "goals":
        return (fields + ",priority,fund_cadence", fields + ",priority", fields) if reading else (fields + ",priority", fields)
    return (fields,)


async def write_plan(plan: Plan, payload: dict, client: Database, entry_id: UUID | None = None):
    table, fields, model = PLANNING[plan]
    try:
        value = model.model_validate(payload)
    except ValidationError as exc:
        raise HTTPException(422, "Check the planning fields and try again.") from exc
    if plan == "subscriptions" and entry_id is not None:
        await request(client, "POST", "rpc/sync_my_subscriptions", json={})
    params = {}
    if entry_id is not None:
        params["id"] = f"eq.{entry_id}"
        if plan == "bill-funds":
            params["fund_cadence"] = "not.is.null"
    method = "POST" if entry_id is None else "PATCH"
    data = value.model_dump(mode="json", exclude_none=True)
    headers = {"Prefer": "return=representation"}
    for select in planning_selections(plan, fields, reading=False):
        try:
            rows = await request(client, method, table, params={**params, "select": select}, json=data, headers=headers)
            break
        except HTTPException as error:
            if error.detail != PLANNING_SCHEMA_MESSAGE or select == fields:
                raise
            if "reset_period" in select:
                if data.get("reset_period") not in {None, "monthly"} or data.get("starts_on") is not None:
                    raise
                data.pop("reset_period", None)
            elif data.get("priority") in {None, "normal"}:
                data.pop("priority", None)
            else:
                raise
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
    params = {"id": f"eq.{entry_id}"}
    if plan == "bill-funds":
        params["fund_cadence"] = "not.is.null"
    await request(client, "DELETE", table, params=params)
    return Response(status_code=204)


def receipt_key(text: str) -> str:
    return " ".join(text.lower().split())


async def read_receipt_upload(photo: Request, client: httpx.AsyncClient) -> bytes:
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
    return bytes(image)


async def scan_photo(image: bytes, on_stage=None):
    if ocr_lock.locked():
        raise HTTPException(429, "The scanner is busy. Try again in a moment.")
    async with ocr_lock:
        try:
            return await run_in_threadpool(analyze, image, on_stage=on_stage)
        except ReceiptRecognitionError:
            raise
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(503, "The scanner is unavailable. You can enter the receipt manually.") from exc


async def apply_remembered_products(client: httpx.AsyncClient, draft: dict):
    for receipt in [draft, *draft.get("additional_receipts", [])]:
        if not receipt["store"] or not receipt["lines"]:
            continue
        labels = await request(client, "GET", "receipt_product_labels", params={
            "select": "receipt_key,display_name,category",
            "store_key": "eq." + receipt_key(receipt["store"]),
        })
        known = {row["receipt_key"]: row for row in labels}
        for line in receipt["lines"]:
            saved = known.get(receipt_key(line["receipt_name"])) if line["kind"] == "product" else None
            if saved:
                line.update(display_name=saved["display_name"], category=saved["category"], review=False)
        receipt["spending_category"] = receipt_category(receipt["lines"])
    return draft


def scan_event(kind: str, **payload) -> str:
    return json.dumps({"type": kind, **payload}, ensure_ascii=False) + "\n"


async def receipt_scan_events(image: bytes, client: httpx.AsyncClient):
    loop = asyncio.get_running_loop()
    messages = asyncio.Queue()

    def progress(stage: str):
        loop.call_soon_threadsafe(messages.put_nowait, ("stage", stage))

    def finished(task):
        if task.cancelled():
            return
        # Observe failures even if the client disconnected while OCR was running.
        error = task.exception()
        messages.put_nowait(("failure", error) if error else ("draft", task.result()))

    task = asyncio.create_task(scan_photo(image, progress))
    task.add_done_callback(finished)
    try:
        while True:
            kind, value = await messages.get()
            if kind == "stage":
                yield scan_event("stage", stage=value)
                continue
            if kind == "failure":
                raise value
            yield scan_event("stage", stage="checking")
            draft = await apply_remembered_products(client, value)
            yield scan_event("result", draft=draft)
            return
    except ReceiptRecognitionError as exc:
        yield scan_event("error", message=str(exc), code="receipt_unreadable")
    except HTTPException as exc:
        yield scan_event("error", message=exc.detail)


@app.post("/v1/receipts/analyze")
async def analyze_receipt(photo: Request, client: Database):
    image = await read_receipt_upload(photo, client)
    if "application/x-ndjson" in photo.headers.get("accept", ""):
        return StreamingResponse(
            receipt_scan_events(image, client), media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no"},
        )
    try:
        return await apply_remembered_products(client, await scan_photo(image))
    except ReceiptRecognitionError as exc:
        raise HTTPException(422, str(exc)) from exc


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

    lines[0]["spending_category"] = receipt.spending_category or receipt_category(lines)
    receipt_id = await request(client, "POST", "rpc/save_receipt", json={
        "receipt_id": str(receipt.id), "merchant": receipt.store, "receipt_date": receipt.date.isoformat(),
        "total": total, "lines": lines,
    })
    return {"id": receipt_id}
