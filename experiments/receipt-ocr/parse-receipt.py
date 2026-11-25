"""Turn PaddleOCR receipt JSON into a reviewable receipt draft."""

import argparse
import json
import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path
from statistics import median

AMOUNT = r"[+-]?\d+[.,]\d{2}"
PRICE = re.compile(rf"^\s*({AMOUNT})\s*([A-Z])?\s*$")
INLINE_PRICE = re.compile(rf"^(.+?\D)\s+({AMOUNT})\s*([A-Z])?\s*$")
DATE = re.compile(r"\b(?:(\d{4})-(\d{2})-(\d{2})|(\d{1,2})[./-](\d{1,2})[./-](\d{4}))\b")
TIME = re.compile(r"\b(?:[01]\d|2[0-3]):[0-5]\d\b")
TOTAL = re.compile(r"^(?:summe|gesamt(?:summe|betrag)?|endbetrag|(?:grand\s+)?total(?:\s+due)?|ukupno)\b", re.I)
DISCOUNT = re.compile(r"^(?:mengen\s*vorteil|rabatt|coupon|rabat|popust|discount)", re.I)
DEPOSIT = re.compile(r"^(?:pfand|deposit|povratna naknada)\b", re.I)
QUANTITY = re.compile(rf"^(\d+(?:[.,]\d+)?)\s*([x×])?\s+({AMOUNT})$", re.I)
PACK = re.compile(r"(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b", re.I)


@dataclass(frozen=True)
class Region:
    text: str
    x: float
    y: float
    left: float
    right: float
    height: float
    confidence: float


def regions(payload: dict) -> list[Region]:
    result = []
    for line in payload["lines"]:
        text = line["text"].strip()
        if not text:
            continue
        xs, ys = zip(*line["polygon"], strict=True)
        height = (abs(ys[3] - ys[0]) + abs(ys[2] - ys[1])) / 2
        result.append(Region(text, sum(xs) / 4, sum(ys) / 4,
                             min(xs), max(xs), height, line["confidence"]))
    return sorted(result, key=lambda line: (line.y, line.x))


def cents(value: str) -> int:
    return int(Decimal(value.replace(",", ".")) * 100)


def find_date(lines: list[Region]) -> tuple[str | None, str | None, float | None]:
    for line in lines:
        match = DATE.search(line.text)
        if not match:
            continue
        y1, m1, d1, d2, m2, y2 = match.groups()
        try:
            value = date(int(y1 or y2), int(m1 or m2), int(d1 or d2))
        except ValueError:
            continue
        time = TIME.search(line.text)
        return value.isoformat(), time.group() if time else None, line.y
    return None, None, None


def entry_type(name: str) -> str:
    if DISCOUNT.match(name):
        return "discount"
    if DEPOSIT.match(name):
        return "deposit"
    return "product"


def pick_store(lines: list[Region], first_body_y: float) -> str | None:
    candidates = [
        line for line in lines if line.y < first_body_y
        and len(re.findall(r"[^\W\d_]", line.text)) >= 4
        and not re.search(r"\d|straße|strasse|street|route|tel[:.]", line.text, re.I)
    ]
    best = max(candidates, key=lambda line: line.height * (line.right - line.left), default=None)
    return best.text if best else None


def split_body(body: list[Region], price_column: float):
    names, prices, details = [], [], []
    for line in body:
        direct = PRICE.fullmatch(line.text)
        inline = INLINE_PRICE.fullmatch(line.text)
        if direct and line.x >= price_column:
            prices.append((line.y, cents(direct[1]), direct[2], line.confidence))
        elif inline and line.right >= price_column and not QUANTITY.fullmatch(line.text):
            names.append((line, inline[1].strip()))
            prices.append((line.y, cents(inline[2]), inline[3], line.confidence))
        elif line.x < price_column and len(re.findall(r"[^\W\d_]", line.text)) >= 3:
            if line.text.upper() not in {"EUR", "USD", "GBP", "ITEM", "ITEMS", "PRICE", "ARTICLE"}:
                names.append((line, line.text))
        elif line.x < price_column:
            details.append(line)
    return names, prices, details


def align_rows(names, prices, typical_height: float):
    """Minimum-cost ordered matching. Skips leave uncertainty visible in the output."""
    n, m = len(names), len(prices)
    costs = [[float("inf")] * (m + 1) for _ in range(n + 1)]
    steps = {}
    costs[0][0] = 0.0
    for i in range(n + 1):
        for j in range(m + 1):
            options = []
            if i < n:
                options.append((i + 1, j, 2.8, "name"))
            if j < m:
                options.append((i, j + 1, 2.8, "price"))
            if i < n and j < m:
                line, name = names[i]
                amount_y, amount, _, _ = prices[j]
                correct_sign = (entry_type(name) == "discount") == (amount < 0)
                gap = abs(amount_y - line.y) / typical_height
                if gap < 2.4 and correct_sign:
                    options.append((i + 1, j + 1, gap, "match"))
            for next_i, next_j, cost, action in options:
                candidate = costs[i][j] + cost
                if candidate < costs[next_i][next_j]:
                    costs[next_i][next_j] = candidate
                    steps[next_i, next_j] = action

    matches, unmatched = {}, []
    i, j = n, m
    while i or j:
        match steps[i, j]:
            case "match":
                matches[i - 1] = prices[j - 1]
                i, j = i - 1, j - 1
            case "name":
                i -= 1
            case "price":
                unmatched.append(prices[j - 1][1])
                j -= 1
    return matches, list(reversed(unmatched))


def infer_quantity(details: list[Region], line: Region, next_y: float,
                   amount: int | None, typical_height: float):
    """Look below a product name for quantity and unit price in its own region."""
    rows = []
    for part in details:
        if not line.y + typical_height * 0.35 < part.y < next_y - typical_height * 0.12:
            continue
        if rows and abs(rows[-1][0].y - part.y) <= typical_height * 0.5:
            rows[-1].append(part)
        else:
            rows.append([part])
    for row in rows:
        text = " ".join(part.text for part in sorted(row, key=lambda part: part.x))
        match = QUANTITY.fullmatch(text)
        if match:
            count = Decimal(match[1].replace(",", "."))
            unit_price = cents(match[3])
            if count > 0 and (match[2] or count * unit_price == amount):
                return float(count), unit_price, "printed" if match[2] else "reconstructed"
        price = PRICE.fullmatch(text)
        if price and amount is not None:
            unit_price = cents(price[1])
            if unit_price > 0 and amount % unit_price == 0 and 1 < amount // unit_price <= 1000:
                return amount // unit_price, unit_price, "inferred_from_price"
    return None, None, None


def parse_receipt(payload: dict) -> dict:
    lines = regions(payload)
    height = max(8, median([line.height for line in lines]) if lines else 24)
    purchased_on, clock, date_y = find_date(lines)
    total_label = next((line for line in reversed(lines) if TOTAL.match(line.text)), None)
    total_y = total_label.y if total_label else float("inf")
    currency_header = next((line for line in lines if line.text.upper() in {"EUR", "USD", "GBP"} and line.y < total_y), None)
    first_body_y = (date_y + height * 0.55 if date_y is not None
                    else currency_header.y - height * 0.3 if currency_header else -float("inf"))
    body = [line for line in lines if first_body_y < line.y < total_y - height * 0.8
            and not re.match(r"^(?:ihre ersp|savings|usted ahorr|u[šs]teda)", line.text, re.I)]
    left = min((line.left for line in body), default=0)
    right = max((line.right for line in body), default=1)
    price_column = left + (right - left) * 0.67

    total = None
    if total_label:
        on_label = re.search(AMOUNT, total_label.text[TOTAL.match(total_label.text).end():])
        if on_label:
            total = cents(on_label.group())
        else:
            nearby = [line for line in lines if line.x >= price_column
                      and abs(line.y - total_y) <= 1.35 * height and PRICE.fullmatch(line.text)]
            nearest = min(nearby, key=lambda line: abs(line.y - total_y), default=None)
            if nearest:
                total = cents(PRICE.fullmatch(nearest.text)[1])

    names, prices, details = split_body(body, price_column)
    matches, unmatched = align_rows(names, prices, height)
    items, adjustments, warnings = [], [], []
    for index, (line, name) in enumerate(names):
        kind = entry_type(name)
        match_price = matches.get(index)
        amount = match_price[1] if match_price else None
        next_y = names[index + 1][0].y if index + 1 < len(names) else total_y
        quantity, unit_price, source = infer_quantity(details, line, next_y, amount, height)
        entry = {"name": name, "line_total_minor": amount}
        if kind != "discount":
            entry.update(quantity=quantity, quantity_source=source, unit_price_minor=unit_price)
        if not match_price:
            warnings.append(f"No reliable line price for {name}.")
        elif min(line.confidence, match_price[3]) < 75:
            warnings.append(f"Low OCR confidence on {name}.")
        if source == "inferred_from_price":
            warnings.append(f"Quantity for {name} inferred from its line total and unit price.")
        if quantity is not None and unit_price is not None and amount is not None:
            if Decimal(str(quantity)) * unit_price != amount:
                warnings.append(f"Quantity and unit price do not match the line total for {name}.")
        if kind == "product":
            pack = PACK.search(name)
            if pack:
                size = Decimal(pack[1].replace(",", "."))
                unit = pack[2].lower()
                entry["package_size"] = {
                    "value": float(size / 1000 if unit in {"g", "ml"} else size),
                    "unit": "L" if unit in {"ml", "l"} else "kg",
                }
            items.append(entry)
        else:
            adjustments.append({"type": kind, **entry})

    currency = currency_header.text.upper() if currency_header else None
    if not currency:
        money = next((match for line in lines if (match := re.search(r"\b(EUR|USD|GBP)\b|([€$£])", line.text))), None)
        if money:
            currency = money[1] or {"€": "EUR", "$": "USD", "£": "GBP"}[money[2]]
    store = pick_store(lines, first_body_y)
    computed = sum(entry["line_total_minor"] for entry in items + adjustments if entry["line_total_minor"] is not None)
    if total is None or total != computed:
        warnings.append("The matched line amounts do not verify the printed grand total.")
    if unmatched:
        warnings.append("Some amounts could not be matched to a line.")
    if not all((store, purchased_on, currency)):
        warnings.append("Store, date or currency is missing.")
    return {
        "status": "needs_review", "source_engine": payload.get("engine"),
        "store": store, "date": purchased_on, "time": clock, "currency": currency,
        "total_minor": total, "items": items, "adjustments": adjustments,
        "reconciliation": {"matched_total_minor": computed, "matches_printed_total": total is not None and total == computed,
                           "unmatched_amounts_minor": unmatched},
        "warnings": warnings,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ocr_json", type=Path, help="JSON result from read-rapidocr.py")
    args = parser.parse_args()
    try:
        payload = json.loads(args.ocr_json.read_text(encoding="utf-8"))
        if not isinstance(payload, dict) or not isinstance(payload.get("lines"), list):
            raise ValueError("Expected PaddleOCR JSON with a lines array.")
        draft = parse_receipt(payload)
        directory = Path(__file__).resolve().parent / "results"
        directory.mkdir(exist_ok=True)
        for attempt in range(1, 10000):
            suffix = "" if attempt == 1 else f"-{attempt}"
            output = directory / f"{args.ocr_json.stem}-parsed{suffix}.json"
            try:
                with output.open("x", encoding="utf-8") as handle:
                    json.dump(draft, handle, indent=2, ensure_ascii=False)
                    handle.write("\n")
                break
            except FileExistsError:
                continue
        else:
            raise ValueError("Too many drafts for this OCR file.")
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f"Could not parse receipt: {error}\n")
    print(f"Saved draft to: {output}")
    print(f"Products: {len(draft['items'])} | Adjustments: {len(draft['adjustments'])}")


if __name__ == "__main__":
    main()
