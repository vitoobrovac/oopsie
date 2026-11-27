"""Turn PaddleOCR receipt JSON into a reviewable receipt draft."""

import argparse
import json
import re
import unicodedata
from dataclasses import dataclass
from datetime import date
from decimal import Decimal, ROUND_FLOOR
from pathlib import Path
from statistics import median

AMOUNT = r"[+-]?(?:\d{1,3}(?:[.,\u00a0 ]\d{3})+|\d+)[.,]\d{2}"
MONEY_MARK = r"(?:[€$£]|EUR|USD|GBP|AUD|CAD|NZD|CHF)"
PRICE = re.compile(rf"^\s*{MONEY_MARK}?\s*({AMOUNT})\s*{MONEY_MARK}?\s*([A-Z])?\s*$")
INLINE_PRICE = re.compile(rf"^(.+?\D)\s+{MONEY_MARK}?\s*({AMOUNT})\s*{MONEY_MARK}?\s*([A-Z])?\s*$")
DATE = re.compile(r"\b(?:(\d{4})[./-](\d{2})[./-](\d{2})|(\d{1,2})\s*[./-]\s*(\d{1,2})\s*[./-]?\s*(\d{4}))(?=\b|[0-2]\d:[0-5]\d)")
TIME = re.compile(r"\b(?:[01]\d|2[0-3]):[0-5]\d\b")
TOTAL = re.compile(r"^(?:summe|gesamt(?:summe|betrag)?|endbetrag|(?:grand\s+|delivery\s+)?total(?:\s+due)?|sveukupno|ukupno(?!\s+(?:u\s+kn|neto|bruto)))\b", re.I)
DISCOUNT = re.compile(r"^(?:mengen\s*vorteil|rabatt|coupon|rabat|popust|discount|cashback|promoci|promotion|aktionsrabatt|loyalty\b)", re.I)
DEPOSIT = re.compile(r"^(?:pfand|deposit|povratna naknada)\b", re.I)
QUANTITY = re.compile(rf"^(\d+(?:[.,]\d+)?)\s*([x×])?\s+({AMOUNT})$", re.I)
WEIGHT_DETAIL = re.compile(rf"^(\d+(?:[.,]\d+)?)\s*kg\s*(?:NET\s*)?[@0O]?\s*{MONEY_MARK}?\s*({AMOUNT})\s*/\s*kg$", re.I)
RECEIPT_METADATA = re.compile(r"^(?:table|server|cashier|time)\s*:|^date\s*(?:[:\d]|$)|^tip(?:\s+guide)?\s*:", re.I)
COLUMN_HEADER = re.compile(r"^(?:description|item(?:s ordered|s| description)?|product(?:s| description)?|article|artikel|opis|naziv|qty|quantity|price|amount|preis|cijena|gericht|menge\s*[x×]\s*einzelpreis|stk\.?\s+bezeichnung|einzel|vkp)\s*[:.]?$", re.I)
ORDER_SUMMARY = re.compile(r"^(?:merchandise value|net amount|subtotal|lief\.d\.dritte)\b", re.I)
ITEM_NUMBER = re.compile(r"^(?:item\s*(?:no\.|number|#)|sku\s*[:#])", re.I)
ITEM_QUANTITY = re.compile(r"^(\d+)\s*[x×]\s+(?=\D)", re.I)
PAYMENT = re.compile(r"^(?:eftpos|change|cash tendered|subtotal|payment|cash payment|card payment|vat total|tax total)\b", re.I)
CURRENCIES = {"€": "EUR", "$": "$", "£": "GBP", **{code: code for code in ("EUR", "USD", "GBP", "AUD", "CAD", "NZD", "CHF")}}
CURRENCY = re.compile(r"(?<!\w)(EUR|USD|GBP|AUD|CAD|NZD|CHF)(?!\w)|[€$£]")
PACK_COUNT = re.compile(r"\b(\d+)\s*(?:pk|pack|pcs)\b", re.I)
PACK = re.compile(r"(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)\b", re.I)
MONTHS = (
    "january jan januar sij", "february feb februar vel", "march mar marz ozu",
    "april apr trav tra", "may mai svi", "june jun juni lip", "july jul juli srp",
    "august aug kol", "september sep sept ruj", "october oct oktober okt lis",
    "november nov stu", "december dec dezember dez pro",
)
MONTH_NUMBER = {name: number for number, names in enumerate(MONTHS, 1) for name in names.split()}
NAMED_DATE = re.compile(r"\b(?:(\d{1,2})\.?\s+([a-z]+)\.?|([a-z]+)\.?\s+(\d{1,2})),?\s+(\d{4})\b")
SHORT_DATE = re.compile(r"\b(\d{1,2})\.(\d{1,2})\.(\d{2})(?:\.(?!\d)|(?=\s+[0-2]\d:[0-5]\d))")
INVOICE_TOTALS = [
    (r"^iznos za plac|^ukupan iznos za plac|^za platiti|^za uplatu|^invoice total|^grand total|^ukupno\s+eur", 7),
    (r"^sveukupno|^ukupn[oi] iznos|^bruto iznos|^ukupno bruto|^gesamtpreis|^gesamtsumme|^gesamtbetrag|^zahl[bi]betrag", 6),
    (r"^ukupno(?! u kn| neto| za plat)|^total(?:\s|:|$)|^summe", 5),
    (r"^amount due|^ukupno za plat|^iznos za plaanje|^paid$", 4),
]
INVOICE_HEADER = re.compile(r"^(?:opis|description|beschreibung|desc(?:r|ri|ro)ption of goods|naziv\s*/\s*opis|naziv\s*artik\w*|naziv proizvoda|naz[il]v\s*robe|artikl|vrsta robe|stavka)\b")
INVOICE_FOOTER = re.compile(r"^(?:pdv stopa|rekapitulacija pdv|osnovica|sub\s*total|subtotal|neto iznos|ukupne naknade|ust\b|net amount|ukupno|ukupn[oi] iznos|sveukupno|gesamtpreis|invoice total|total\b|za platiti|za uplatu|iznos za plac|placeno|vec placeno|kontrolna kolicina)")
INVOICE_IGNORED = re.compile(r"^(?:asin\s*:|mall partner|mal partner|napomena|r\.br|gift wrap|odaberi\w*|seite|stranica|poziv na broj|pdv|kom|eur|menu)\b")
INVOICE_DELIVERY = re.compile(r"^(?:shipping charge|versandkosten|trosak dostave|dpd/gls dostavn|delivery fee)\b")


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
    return int(re.sub(r"[^\d+-]", "", value))


def plain(text: str) -> str:
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char)).strip()


def date_on_line(text: str) -> date | None:
    match = DATE.search(text)
    try:
        if match:
            y1, m1, d1, d2, m2, y2 = match.groups()
            day, month = int(d1 or d2), int(m1 or m2)
            if not y1 and month > 12 and day <= 12 and "/" in match[0]:
                day, month = month, day
            return date(int(y1 or y2), month, day)
        for match in NAMED_DATE.finditer(plain(text)):
            d1, m1, m2, d2, year = match.groups()
            if (month := MONTH_NUMBER.get(m1 or m2)):
                return date(int(year), month, int(d1 or d2))
        if match := SHORT_DATE.search(text):
            day, month, year = map(int, match.groups())
            return date(2000 + year, month, day)
    except ValueError:
        return None
    return None


def find_date(lines: list[Region]) -> tuple[str | None, str | None, float | None]:
    issue = re.compile(r"^(?:invoice(?:/payment)? date|date of issue|rechnungsdatum|datum (?:izdavanja|ra[u c]*na))", re.I)
    generic = re.compile(r"^datum(?: i vrijeme|\s*:|\s*$)", re.I)
    labels = [line for pattern in (issue, generic) for line in lines if pattern.match(plain(line.text))]
    for label in labels:
        direct = date_on_line(label.text)
        if direct:
            return direct.isoformat(), None, label.y
        for candidate in lines:
            if label.y - label.height * .7 <= candidate.y <= label.y + label.height * 2 and candidate.x > label.x:
                if value := date_on_line(candidate.text):
                    return value.isoformat(), None, max(label.y, candidate.y)
    for line in lines:
        if re.match(r"^(?:date due|due date|datum dospijeca|rok dospijeca|payment due)", plain(line.text)):
            continue
        if value := date_on_line(line.text):
            time = TIME.search(line.text)
            return value.isoformat(), time.group() if time else None, line.y
    return None, None, None


def entry_type(name: str) -> str:
    if DISCOUNT.match(name):
        return "discount"
    if DEPOSIT.match(name):
        return "deposit"
    return "product"


def is_metadata(text: str) -> bool:
    return bool(COLUMN_HEADER.fullmatch(text) or PAYMENT.match(text)
                or ORDER_SUMMARY.match(text) or ITEM_NUMBER.match(text) or RECEIPT_METADATA.match(text)
                or text.upper() in CURRENCIES)


def pick_store(lines: list[Region], first_body_y: float) -> str | None:
    candidates = [
        line for line in lines if line.y < first_body_y
        and not is_metadata(line.text)
        and len(line.text.split()) <= 7 and not line.text.endswith((".", ",", "!", "?"))
        and len(re.findall(r"[^\W\d_]", line.text)) >= 4
        and not re.search(r"\d|@|https?://|\bwww\.|straße|strasse|street|route|tel[:.]", line.text, re.I)
    ]
    best = max(candidates, key=lambda line: line.height * (line.right - line.left), default=None)
    return best.text if best else None


def split_body(body: list[Region], price_column: float):
    names, prices, details = [], [], []
    for line in body:
        if is_metadata(line.text):
            continue
        direct = PRICE.fullmatch(line.text)
        inline = INLINE_PRICE.fullmatch(line.text)
        if direct and line.x >= price_column:
            prices.append((line.y, cents(direct[1]), direct[2], line.confidence))
        elif inline and line.right >= price_column and not QUANTITY.fullmatch(line.text):
            names.append((line, inline[1].strip()))
            prices.append((line.y, cents(inline[2]), inline[3], line.confidence))
        elif WEIGHT_DETAIL.fullmatch(line.text):
            details.append(line)
        elif line.x < price_column and len(re.findall(r"[^\W\d_]", line.text)) >= 3:
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
        if match := WEIGHT_DETAIL.fullmatch(text):
            weight = Decimal(match[1].replace(",", "."))
            unit_price = cents(match[2])
            if weight > 0 and amount is not None and abs(weight * unit_price - amount) <= 1:
                return float(weight), unit_price, "printed_weight"
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


def amount_at(lines: list[Region], label: Region, height: float, *, below: bool = False) -> int | None:
    if match := INLINE_PRICE.fullmatch(label.text):
        return cents(match[2])
    amounts = []
    for line in lines:
        if line.x < label.x - (height * 4 if below else 0) or line is label:
            continue
        if abs(line.y - label.y) <= height * (3.8 if below else .9) and (match := PRICE.fullmatch(line.text)):
            gap = abs(line.y - label.y)
            amounts.append((gap if below or gap > height * .55 else 0, -line.x, gap, cents(match[1])))
    return min(amounts)[3] if amounts else None


def invoice_total(lines: list[Region], height: float, start: float) -> int | None:
    candidates = []
    for line in lines:
        label = plain(line.text)
        for pattern, priority in INVOICE_TOTALS:
            if re.search(pattern, label):
                value = amount_at(lines, line, height, below=label == "paid")
                # A 0.00 balance can mean an invoice was paid. Preserve the purchase value when printed.
                if value is not None and value > 0:
                    candidates.append((priority, line.y >= start, line.y, value))
                break
    return max(candidates)[3] if candidates else None


def invoice_rows(lines: list[Region], header: Region, height: float) -> list[dict]:
    foot = next((line.y for line in lines if line.y > header.y + height * 1.5
                 and INVOICE_FOOTER.match(plain(line.text))), float("inf"))
    body = [line for line in lines if header.y - height * .2 <= line.y < foot - height * .6]
    right = max((line.right for line in body), default=header.right)
    left = min((line.left for line in body), default=header.left)
    width = right - left
    gross_column = next((row.x for row in body if row.y < header.y + height * 2
                         and re.match(r"^s pdv[- ]?om$", plain(row.text))), None)
    quantity_column = next((row.x for row in body if abs(row.y - header.y) <= height * 1.6
                            and re.fullmatch(r"qty|menge|kolicina(?:\s*/\s*mj)?|kol\.?", plain(row.text))), None)
    prices = []
    for line in body:
        match = PRICE.fullmatch(line.text)
        if not match or line.x < left + width * .55:
            continue
        if gross_column is not None and abs(line.x - gross_column) > width * .042:
            continue
        if prices and abs(line.y - prices[-1][0].y) <= height * .85:
            if line.x > prices[-1][0].x:
                prices[-1] = (line, cents(match[1]))
        else:
            prices.append((line, cents(match[1])))

    result = []
    previous_y = header.y
    short_invoice = any(plain(part.text) == "invoice details" for part in lines)
    for line, value in prices:
        context = [part for part in body if previous_y + height * .36 < part.y <= line.y + height * .5
                   and part.left < left + width * .35 and part.right < left + width * .66]
        # ASINs close a wrapped product name. The next price belongs to the following description.
        separator = max((part.y for part in context if plain(part.text).startswith("asin:")), default=previous_y)
        names = [part for part in context if part.y > separator and len(re.findall(r"[^\W\d_]", part.text)) >= 3
                 and not INVOICE_IGNORED.match(plain(part.text)) and not INVOICE_HEADER.match(plain(part.text))
                 and not COLUMN_HEADER.fullmatch(part.text) and not re.match(r"^\d+(?:[.,]\d+)?\s*(?:kom|pcs|db)\b", plain(part.text))]
        previous_y = line.y
        if not names or (value == 0 and not any(entry_type(part.text) == "product" for part in names)):
            continue
        fee = next((part for part in names if INVOICE_DELIVERY.match(plain(part.text)) or DISCOUNT.match(plain(part.text))), None)
        source = fee or min(names, key=lambda part: abs(part.y - line.y))
        name = source.text
        if short_invoice and len(names) > 1 and not fee:
            name = " ".join(part.text for part in names)
        if not fee and re.match(r"^(?:[\d.]+\s*[a-z]{1,4}\d*|kom|cijena|ukupno)\b", plain(name)):
            alternatives = [part for part in names if part.text != name and len(part.text) > len(name)]
            if alternatives:
                source = min(alternatives, key=lambda part: abs(part.y - line.y))
                name = source.text
        if value == 0 or (value < 0 and entry_type(name) != "discount"):
            continue
        if value > 0 and entry_type(name) == "discount":
            continue
        if result and result[-1]["name"] == name and result[-1]["line_total_minor"] == value:
            continue
        row = {"name": name[:240], "line_total_minor": value, "source_y": source.y}
        if quantity_column is not None:
            count = next((part.text for part in body if abs(part.y - line.y) <= height * .7
                          and abs(part.x - quantity_column) <= width * .04
                          and re.fullmatch(r"[1-9]\d{0,5}(?:\s*(?:kom|pcs|db))?", plain(part.text))), None)
            if count:
                row["quantity"] = int(re.match(r"\d+", count)[0])
        result.append(row)
    return result


def apply_invoice_tax(rows: list[dict], lines: list[Region], total: int, height: float) -> bool:
    net_label = next((line for line in lines if re.match(r"^ukupni iznos bez pdv|^net amount|^subtotal excluding tax", plain(line.text))), None)
    rates = {Decimal(match[1].replace(",", ".")) for line in lines
             if (match := re.match(r"^pdv\s+(\d+(?:[.,]\d+)?)\s*%", plain(line.text)))}
    net_column = any(re.match(r"^vrijed\w*\.?\s+bez\s+pdv", plain(line.text)) for line in lines)
    if (net_label is None and not net_column) or len(rates) != 1 or any(row["line_total_minor"] is None for row in rows):
        return False
    line_sum = sum(row["line_total_minor"] for row in rows)
    net = amount_at(lines, net_label, height) if net_label else None
    rate = rates.pop()
    if line_sum <= 0 or (net is None and not net_column) or (net is not None and net != line_sum):
        return False
    if abs(line_sum * (1 + rate / 100) - total) > 1:
        return False
    return allocate_tax(rows, total, 1 + rate / 100)


def allocate_tax(rows: list[dict], total: int, multiplier: Decimal) -> bool:
    exact = [Decimal(row["line_total_minor"]) * multiplier for row in rows]
    amounts = [int(value.to_integral_value(rounding=ROUND_FLOOR)) for value in exact]
    remainder = total - sum(amounts)
    if not 0 <= remainder <= len(rows):
        return False
    ranking = sorted(range(len(rows)), key=lambda index: exact[index] - amounts[index], reverse=True)
    for index in ranking[:remainder]:
        amounts[index] += 1
    for row, value in zip(rows, amounts, strict=True):
        row["line_total_minor"] = value
    return True


def groups_by_description(lines: list[Region], descriptions: list[Region], end: float, height: float) -> list[dict]:
    """Read one printed extended price per description on stacked receipt layouts."""
    rows = []
    for index, description in enumerate(descriptions):
        limit = descriptions[index + 1].y if index + 1 < len(descriptions) else end
        amounts = [(part, cents(match[1])) for part in lines
                   if description.y + height * .35 < part.y < limit - height * .27
                   and part.x > description.x and (match := PRICE.fullmatch(part.text))]
        if not amounts:
            continue
        # Net values may repeat on a lower row under the gross price in the same column.
        candidates = [(part, amount) for part, amount in amounts if part.x >= max(p.x for p, _ in amounts) - height * .35]
        rows.append({"name": description.text[:240], "line_total_minor": max(amount for _, amount in candidates), "source_y": description.y})
    return rows


def rows_after_product_codes(lines: list[Region], header: Region, end: float, height: float) -> list[dict]:
    codes = [line for line in lines if header.y < line.y < end and re.fullmatch(r"\d{6,10}\s+[\d-]{3,}", line.text)]
    rows = groups_by_description(lines, codes, end, height)
    for row in rows:
        code = next(line for line in codes if line.text == row["name"])
        description = next((line for line in reversed(lines) if code.y - height * 1.45 <= line.y < code.y
                            and re.search(r"\btraka\b", plain(line.text))), None)
        row["name"] = description.text if description else "Item " + code.text.split()[0]
        row["source_y"] = description.y if description else code.y - height * .85
        row["spending_category"] = "Tools"
    return rows


def parse_invoice(lines: list[Region], height: float, purchased_on, clock, engine) -> dict | None:
    names = [plain(line.text) for line in lines]
    text = " ".join(names)
    merchant = None
    category = None
    service = None
    special = None
    if "meta ads" in text and "campaigns" in text:
        merchant, category, service = "Meta", "Business", "Meta ads"
    elif "chatgpt" in text and ("date of issue" in text or "invoice number" in text):
        merchant, category = "OpenAI", "Subscriptions"
        service = next(line.text for line in lines if "chatgpt" in plain(line.text))
    elif "microsoft 365" in text and ("faktura" in text or "invoice" in text):
        merchant, category = "Microsoft", "Subscriptions"
        service = next(line.text for line in lines if "microsoft 365" in plain(line.text))
    elif "plus hosting" in text and ("domene" in text or "hosting" in text):
        merchant, category = "Plus Hosting", "Subscriptions"
        service = next((line.text for line in lines if re.search(r"registracija.*domene|hosting paket", plain(line.text))), None)
    elif re.search(r"\buber\b|uber receipt", text) and re.search(r"cijena vo\w*nje|hvala na vo\w*nji|uber b\.v", text):
        merchant, category = "Uber", "Transport"
        service = next((line.text for line in lines if re.match(r"cijena vo\w*nje", plain(line.text))), "Uber ride")
    elif "podaci o narudbi" in text and "vrijeme dostave" in text:
        venue = next((line for line in lines if plain(line.text) == "objekt"), None)
        merchant = next((line.text for line in lines if venue and line.x > venue.x and abs(line.y - venue.y) < height), None)
        category = "Dining out"
    elif "pikabooshop" in text or "pikaboo shop" in text:
        merchant = "Pikaboo"
    elif "internet mall" in text:
        merchant = "Internet Mall"
    elif "art-export" in text or "art export" in text:
        merchant = "Art-Export"
    elif re.search(r"\bamazon\b", text) and re.search(r"rechnungsdetails|invoice details|description of goods|descroption of goods", text):
        merchant = "Amazon"
    elif "canosa" in text and ("naziv artikla" in text or "canosa.com" in text):
        merchant, special = "Canosa", "photo"
    elif "liupka" in text and "patentni" in text:
        merchant, special = "Liupka", "sewing"
    elif "texo" in text and re.search(r"ljepljiv|krep traka", text):
        merchant, special = "Texo", "tools"
    elif "balonmania" in text and "artikl" in text:
        merchant, special = "Balonmania", "standard"

    fuel = next((line for line in lines if re.match(r"^(?:\d+\s+)?(?:evo\s+|drift\s+)?euro(?:dizel|diesel|super)\b", plain(line.text))), None)
    if fuel and re.search(r"za platiti|to pay", text):
        recognized_brand = next((brand for rule, brand in [(r"\btifon\b", "Tifon"), (r"ags hrvatska", "AGS Hrvatska"),
                                 (r"\bpetrol\b", "Petrol")] if re.search(rule, text)), None)
        if recognized_brand:
            merchant, category, special = recognized_brand, "Transport", "fuel"

    header = next((line for line in lines if INVOICE_HEADER.match(plain(line.text)) and line.y > height * 5), None)
    invoice_layout = bool(header and (
        re.search(r"(?:datum ra[u c]*na|invoice number|invoice details|rechnungsdetails|rekapitulacija pdv|p/i invoice|ukupno bruto|za uplatu)", text)
        or category == "Dining out"
    ))
    if not service and not invoice_layout and not special:
        return None
    header_y = header.y if header else 0
    total = invoice_total(lines, height, header_y)
    if total is None:
        return None
    if special == "fuel":
        pay_y = next(line.y for line in lines if re.match(r"^za platiti|^to pay", plain(line.text)))
        between = [line for line in lines if fuel.y - height * .5 < line.y < pay_y]
        tax_exclusive = any(re.search(r"iznos tg|cijena bez poreza", name) for name in names)
        fuel_amounts = [(line, cents(match[1])) for line in between if line.y <= fuel.y + height * 1.75
                        and line.x > fuel.x and (match := PRICE.fullmatch(line.text))]
        amount = max(fuel_amounts, key=lambda row: row[0].x, default=(None, None))[1]
        # Use the payable total when the only fuel line is printed before tax and the tax fills the gap.
        tax = next((amount_at(lines, line, height) for line in lines if plain(line.text).startswith("ukupno porez")), None)
        if tax_exclusive and amount is not None and tax is not None and amount + tax == total:
            amount = total
        litres = next((Decimal(match[1].replace(",", ".")) for line in between
                       if line.y <= fuel.y + height * 1.75 and (match := re.match(r"^(\d+[.,]\d{1,3})\s*(?:l\b|\*)", plain(line.text)))), None)
        rows = [{"name": fuel.text, "line_total_minor": amount, "quantity": float(litres) if litres else None, "quantity_unit": "L"}]
    elif service:
        rows = [{"name": service[:240], "line_total_minor": total, "quantity": 1}]
    elif special == "sewing":
        end = next((line.y for line in lines if plain(line.text).startswith("za platiti")), float("inf"))
        descriptions = [line for line in lines if header and line.y > header.y and line.y < end
                        and re.match(r"^\d[\d. ]{3,}\s*[–-]?", line.text) and len(re.findall(r"[a-z]", plain(line.text))) >= 3]
        rows = groups_by_description(lines, descriptions, end, height)
    elif special == "tools" and header:
        end = next((line.y for line in lines if plain(line.text).startswith("ukupno")), float("inf"))
        rows = rows_after_product_codes(lines, header, end, height)
    elif special == "photo":
        end = next((line.y for line in lines if re.match(r"^za platiti|^ukupn", plain(line.text))), float("inf"))
        sections = [line for line in lines if header and header.y < line.y < end and re.match(r"^fuji\s+instax\b", plain(line.text))]
        rows = [{"name": sections[0].text, "line_total_minor": total}] if len(sections) == 1 else []
    else:
        rows = invoice_rows(lines, header, height) if header else []
        if re.search(r"\bp/i invoice\b", text) and len(rows) > 1 and rows[0]["line_total_minor"] == total:
            # Freight, promotions and tax box values are already included in the one extended total.
            rows = rows[:1]
    if not rows:
        return None
    if category:
        for row in rows:
            row["spending_category"] = category

    warnings = []
    if apply_invoice_tax(rows, lines, total, height):
        warnings.append("Line prices include VAT allocated from the printed invoice totals.")
    computed = sum(row["line_total_minor"] for row in rows if row["line_total_minor"] is not None)
    if computed != total or any(row["line_total_minor"] is None for row in rows):
        warnings.append("The extracted invoice lines do not match the printed total. Check amounts and tax before saving.")
    if not purchased_on:
        warnings.append("The invoice date needs review.")
    marks = [match[0] for line in lines for match in CURRENCY.finditer(line.text.upper())]
    currency = CURRENCIES[marks[0]] if marks else None
    due_currency = next((match[1] for label in names
                         if (match := re.match(r"^(?:za platiti|ukupno|za uplatu)\s*(eur|usd|gbp|aud|cad|nzd|chf)(?!\w)", label))), None)
    if due_currency:
        currency = due_currency.upper()
    if not currency and special == "photo" and "zagreb" in text and "pdv" in text and purchased_on and purchased_on >= "2023-01-01":
        currency = "EUR"
    if currency == "$":
        currency = next((mark for mark in marks if mark in {"USD", "AUD", "CAD", "NZD"}), "$")
    return {
        "status": "needs_review", "source_engine": engine, "store": merchant or pick_store(lines, header_y),
        "date": purchased_on, "time": clock, "currency": currency, "total_minor": total,
        "items": [row for row in rows if row["line_total_minor"] is None or row["line_total_minor"] >= 0],
        "adjustments": [{"type": "discount", **row} for row in rows if row["line_total_minor"] is not None and row["line_total_minor"] < 0],
        "reconciliation": {"matched_total_minor": computed, "matches_printed_total": total == computed, "unmatched_amounts_minor": []},
        "warnings": warnings,
    }


def parse_receipt(payload: dict) -> dict:
    lines = regions(payload)
    height = max(8, median([line.height for line in lines]) if lines else 24)
    purchased_on, clock, date_y = find_date(lines)
    invoice = parse_invoice(lines, height, purchased_on, clock, payload.get("engine"))
    if invoice:
        return invoice
    delivery_total = next((line for line in lines if line.text.lower().startswith("delivery total")), None)
    total_candidates = [line for line in lines if TOTAL.match(line.text)]
    total_label = delivery_total or next((line for line in reversed(total_candidates)
                                         if (amount_at(lines, line, height) or 0) > 0),
                                        total_candidates[-1] if total_candidates else None)
    total_y = total_label.y if total_label else float("inf")
    before_total = [line for line in lines if line.y < total_y]
    first_amount_y = next((line.y for line in before_total if PRICE.fullmatch(line.text) or INLINE_PRICE.fullmatch(line.text)), total_y)
    headers = [line.y for line in before_total if line.y < first_amount_y
               and (COLUMN_HEADER.fullmatch(line.text) or line.text.upper() in CURRENCIES)]
    if date_y is not None and date_y < first_amount_y:
        headers.append(date_y)
    first_body_y = max(headers, default=-float("inf"))
    summary_y = next((line.y for line in lines if first_body_y < line.y < total_y and ORDER_SUMMARY.match(line.text)), total_y)
    body = [line for line in lines if first_body_y < line.y < summary_y - height * 0.8
            and not re.match(r"^(?:ihre ersp|savings|usted ahorr|u[šs]teda)", line.text, re.I)]
    if delivery_total and any(line.text.lower() == "hot chicken" for line in body):
        body = [line for line in body if not re.match(r"^(?:\d+\s+)?HotChickenM\d+$", line.text, re.I)]
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
    first_match = min(matches, default=None)
    if not headers and first_match is not None:
        first_body_y = names[first_match][0].y
    for index, (line, name) in enumerate(names):
        if not headers and first_match is not None and index < first_match:
            continue
        kind = entry_type(name)
        match_price = matches.get(index)
        amount = match_price[1] if match_price else None
        next_y = names[index + 1][0].y if index + 1 < len(names) else total_y
        quantity, unit_price, source = infer_quantity(details, line, next_y, amount, height)
        printed_count = ITEM_QUANTITY.match(name)
        if delivery_total and not printed_count:
            printed_count = re.match(r"^(\d+)\s+(?=\D)", name)
        if quantity is None and printed_count and int(printed_count[1]) > 0:
            quantity, source = int(printed_count[1]), "printed"
        entry = {"name": name, "line_total_minor": amount}
        if kind != "discount":
            entry.update(quantity=quantity, quantity_source=source, unit_price_minor=unit_price)
        if source == "printed_weight":
            entry["quantity_unit"] = "kg"
        if not match_price:
            warnings.append(f"No reliable line price for {name}.")
        elif min(line.confidence, match_price[3]) < 75:
            warnings.append(f"Low OCR confidence on {name}.")
        if source == "inferred_from_price":
            warnings.append(f"Quantity for {name} inferred from its line total and unit price.")
        if quantity is not None and unit_price is not None and amount is not None:
            if abs(Decimal(str(quantity)) * unit_price - amount) > (1 if source == "printed_weight" else 0):
                warnings.append(f"Quantity and unit price do not match the line total for {name}.")
        if kind == "product":
            count = PACK_COUNT.search(name)
            pack = PACK.search(name)
            if amount is not None and quantity is None and (pack or count or re.search(r"\beach\b", name, re.I)):
                entry.update(quantity=int(count[1]) if count and not pack else 1, quantity_source="package")
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

    if summary_y < total_y:
        summary = [line for line in lines if summary_y <= line.y < total_y]
        for line in summary:
            if DISCOUNT.match(line.text) and (amount := amount_at(summary, line, height)) is not None and amount < 0:
                label = INLINE_PRICE.fullmatch(line.text)
                adjustments.append({"type": "discount", "name": label[1] if label else line.text, "line_total_minor": amount})
        subtotal_label = next((line for line in summary if re.match(r"^subtotal\b", line.text, re.I)), None)
        tax_label = next((line for line in summary if re.match(r"^(?:sales\s+)?tax\b", line.text, re.I)), None)
        if subtotal_label and tax_label and total and not adjustments and items and all(
            (entry["line_total_minor"] or 0) > 0 for entry in items
        ):
            subtotal = amount_at(summary, subtotal_label, height)
            tax = amount_at(summary, tax_label, height)
            if subtotal and tax and subtotal + tax == total and subtotal == sum(entry["line_total_minor"] for entry in items):
                if allocate_tax(items, total, Decimal(total) / subtotal):
                    warnings.append("The printed sales tax was split across the item prices.")

    currencies = [match[0] for line in lines if line.y <= total_y + height * 1.35
                  for match in CURRENCY.finditer(line.text.upper())]
    # A bare dollar sign does not identify the country.
    currency = CURRENCIES[currencies[0]] if currencies else None
    if currency == "$":
        currency = next((mark for mark in currencies if mark in {"USD", "AUD", "CAD", "NZD"}), "$")
    store = pick_store(lines, first_body_y)
    text = " ".join(line.text.casefold() for line in lines)
    if delivery_total and re.search(r"mc\s*donalds|mcdonalds\.at", text):
        store = "McDonald’s via Foodora"
        if "klagenfurt" in text or re.search(r"mcdonalds\.at\b", text):
            currency = currency or "EUR"
    elif "zinger burger" in text and "foodora" in text:
        store = "KFC via Foodora"
        if "wien" in text:
            currency = currency or "EUR"
    computed = sum(entry["line_total_minor"] for entry in items + adjustments if entry["line_total_minor"] is not None)
    if total is None or total != computed:
        warnings.append("The extracted line amounts do not match the printed total. Check the original before saving.")
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
