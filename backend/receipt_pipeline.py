"""Adapter from a local receipt photo to an editable, unsaved draft."""

import runpy
import re
from collections.abc import Callable
from functools import lru_cache
from io import BytesIO
from math import ceil
from pathlib import Path
from statistics import median
from receipt_categories import receipt_category

LAB = Path(__file__).resolve().parents[1] / "experiments" / "receipt-ocr"
SCAN_SIDE = 1800


class ReceiptRecognitionError(ValueError):
    """The image opened successfully, but the scanner could not read receipt lines."""


@lru_cache(maxsize=1)
def pipeline():
    scanner = runpy.run_path(str(LAB / "read-rapidocr.py"))
    parser = runpy.run_path(str(LAB / "parse-receipt.py"))
    matcher = runpy.run_path(str(LAB / "match-products.py"))
    return scanner["recognize_bytes"], parser["parse_receipt"], matcher["enrich_receipt"], matcher["load_catalog"](), scanner["recognize_line"]


def normalize_photo(image: bytes) -> bytes:
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(BytesIO(image)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Choose a JPEG, PNG, or WebP receipt photo.")
            max_pixels = 52_000_000 if source.format == "JPEG" else 12_000_000
            if source.width * source.height > max_pixels:
                raise ValueError("This photo is too large. Try a smaller copy.")
            if source.format == "JPEG" and max(source.size) > SCAN_SIDE:
                scale = SCAN_SIDE / max(source.size)
                # Ask JPEG's decoder for a smaller image before allocating the pixels.
                source.draft("RGB", (max(1, round(source.width * scale)), max(1, round(source.height * scale))))
            source.thumbnail((SCAN_SIDE, SCAN_SIDE))
            ImageOps.exif_transpose(source, in_place=True)
            normalized = BytesIO()
            if source.mode == "RGB":
                source.save(normalized, format="JPEG", quality=95)
            else:
                with source.convert("RGB") as rgb:
                    rgb.save(normalized, format="JPEG", quality=95)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("This photo could not be read. Try a JPEG or PNG.") from exc

    return normalized.getvalue()


def bounds(line: dict) -> tuple[float, float, float, float]:
    xs, ys = zip(*line["polygon"], strict=True)
    return min(xs), min(ys), max(xs), max(ys)


def center(line: dict, axis: int) -> float:
    box = bounds(line)
    return (box[axis] + box[axis + 2]) / 2


def receipt_crops(image: bytes, ocr: dict) -> list[bytes]:
    """Find widely separated receipt headings in sideways photos before reading each slip."""
    from PIL import Image

    lines = [line for line in ocr["lines"] if len(line["text"].strip()) >= 5]
    vertical = []
    for line in lines:
        left, top, right, bottom = bounds(line)
        if bottom - top > (right - left) * 1.4:
            vertical.append(line)
    if len(vertical) < 4 or len(vertical) < len(lines) * 0.55:
        return []

    with Image.open(BytesIO(image)) as source:
        marks = [
            line for line in vertical
            if re.fullmatch(r"euro\s*spar|rechnung|receipt|invoice|bon", line["text"].strip(), re.I)
        ]
        positions = sorted(center(line, 1) for line in marks)
        groups = []
        for position in positions:
            if not groups or position - groups[-1][-1] >= source.height * 0.23:
                groups.append([position])
            else:
                groups[-1].append(position)
        anchors = [median(group) for group in groups]
        cuts = [0, *(ceil((a + b) / 2) for a, b in zip(anchors, anchors[1:])), source.height]
        totals = [line for line in vertical if re.match(r"summe|delivery total|^total\b", line["text"], re.I)]
        turn_left = not marks or not totals or median(center(line, 0) for line in marks) > median(center(line, 0) for line in totals)
        rotation = Image.Transpose.ROTATE_90 if turn_left else Image.Transpose.ROTATE_270
        crops = []
        for top, bottom in zip(cuts, cuts[1:]):
            with source.crop((0, top, source.width, bottom)).transpose(rotation) as candidate:
                buf = BytesIO()
                candidate.save(buf, format="JPEG", quality=95)
                crops.append(buf.getvalue())
        return crops


def reread_delivery_prices(image: bytes, ocr: dict, draft: dict, parse, recognize_line):
    """Re-read the printed final-price column without mixing in menu prices."""
    from PIL import Image, ImageOps

    complete = draft["reconciliation"]["matches_printed_total"] and all(item["line_total_minor"] is not None for item in draft["items"])
    if complete or draft["total_minor"] is None:
        return draft
    lines = ocr["lines"]
    header = next((line for line in lines if line["text"].strip().casefold() == "gesamt"), None)
    footer = next((line for line in lines if line["text"].strip().casefold().startswith("delivery total")), None)
    if not header or not footer or not 1 <= len(draft["items"]) <= 30:
        return draft

    names = {item["name"] for item in draft["items"]}
    rows = sorted((line for line in lines if line["text"].strip() in names), key=lambda row: center(row, 1))
    if len(rows) != len(draft["items"]):
        return draft

    left, top, right, _ = bounds(header)
    typical_gap = median([center(b, 1) - center(a, 1) for a, b in zip(rows, rows[1:])] or [26])
    half_height = max(8, min(17, round(typical_gap * 0.51)))
    prices = []
    with Image.open(BytesIO(image)) as source:
        x1, x2 = max(0, round(left) - 7), min(source.width, round(right) + 13)
        for row in rows:
            y = round(center(row, 1)) + 2
            y1, y2 = max(0, y - half_height), min(source.height, y + half_height)
            strip = source.crop((x1, y1, x2, y2)).convert("L")
            tuned = ImageOps.expand(ImageOps.autocontrast(strip, cutoff=1).resize((strip.width * 3, strip.height * 3)),
                                    border=12, fill=255)
            buf = BytesIO()
            tuned.save(buf, format="PNG")
            value, confidence = recognize_line(buf.getvalue())
            match = re.fullmatch(r"([0-9]+[.,][0-9]{2})\s*[A-Z]?", value.strip())
            if not match:
                return draft
            prices.append({"text": match[1], "confidence": confidence,
                           "polygon": [[x1, y1], [x2, y1], [x2, y2], [x1, y2]]})
    right_column_start = left - 10
    original = [line for line in lines if not (
        center(line, 0) >= right_column_start and top < center(line, 1) < center(rows[-1], 1) + half_height
    ) or line is header]
    updated = parse({**ocr, "lines": original + prices})
    if updated["reconciliation"]["matches_printed_total"] and len(updated["items"]) == len(draft["items"]):
        return updated
    return draft


def rotate_photo(image: bytes, rotation) -> bytes:
    from PIL import Image

    with Image.open(BytesIO(image)) as source:
        buffer = BytesIO()
        source.transpose(rotation).save(buffer, format="JPEG", quality=95)
        return buffer.getvalue()


def draft_quality(draft: dict) -> tuple:
    priced = sum(item["line_total_minor"] is not None for item in draft["items"])
    return (
        bool(priced and draft["reconciliation"]["matches_printed_total"]),
        bool(priced and draft["total_minor"]),
        sum(bool(draft[field]) for field in ("store", "date", "currency")),
        priced,
    )


def zoom_text(image: bytes, rect, recognize) -> list[dict]:
    from PIL import Image, ImageOps

    with Image.open(BytesIO(image)) as source:
        left, top, right, bottom = rect(source.width, source.height)
        if right <= left or bottom <= top:
            return []
        strip = ImageOps.autocontrast(source.crop((left, top, right, bottom)).convert("L"), cutoff=1)
        buffer = BytesIO()
        strip.resize((strip.width * 2, strip.height * 2), Image.Resampling.LANCZOS).save(buffer, format="PNG")
    return [
        {**line, "polygon": [[x / 2 + left, y / 2 + top] for x, y in line["polygon"]]}
        for line in recognize(buffer.getvalue())["lines"] if line["text"].strip()
    ]


def reread_invoice_date(image: bytes, ocr: dict, draft: dict, parse, recognize) -> dict:
    if draft["date"] or not draft["total_minor"]:
        return draft
    due = next((line for line in ocr["lines"] if re.match(r"datum dosp|rok dosp|date due", line["text"], re.I)), None)
    if not due:
        return draft
    left, top, _, bottom = bounds(due)
    height = max(12, bottom - top)
    zoomed = zoom_text(image, lambda width, length: (
        max(0, round(left - height)), max(0, round(top - height * 3)),
        width, min(length, round(bottom + height * 2)),
    ), recognize)
    updated = parse({**ocr, "lines": ocr["lines"] + zoomed})
    if updated["date"]:
        warnings = [text for text in draft["warnings"] if text != "The invoice date needs review."]
        return {**draft, "date": updated["date"], "time": updated["time"], "warnings": warnings}
    return draft


def reread_invoice_names(image: bytes, ocr: dict, draft: dict, enrich, catalog, recognize) -> dict:
    """Zoom the description column on dense invoices and re-read uncertain item names."""
    enriched = enrich(draft, catalog)
    if not any(re.search(r"naz[il]v\s*(?:artik|proizv|robe)|vrsta robe", line["text"], re.I) for line in ocr["lines"]):
        return enriched
    uncertain = [item for item in enriched["items"] if "source_y" in item and item["product"]["status"] == "needs_review"]
    if not uncertain:
        return enriched
    height = max(10, median(bounds(line)[3] - bounds(line)[1] for line in ocr["lines"]))
    top = max(0, round(min(item["source_y"] for item in uncertain) - height * 1.35))
    bottom = round(max(item["source_y"] for item in uncertain) + height * 1.35)
    zoomed = zoom_text(image, lambda width, length: (0, top, round(width * .62), min(bottom, length)), recognize)
    replacement = enrich({"items": [{"name": line["text"]} for line in zoomed]}, catalog)["items"]
    for item in uncertain:
        near = [(line, candidate) for line, candidate in zip(zoomed, replacement, strict=True)
                if abs(center(line, 1) - item["source_y"]) <= height * .58
                and candidate["product"]["status"] == "suggested"]
        if near:
            line, candidate = min(near, key=lambda pair: abs(center(pair[0], 1) - item["source_y"]))
            item.update(name=line["text"][:240], product=candidate["product"])
    return enriched


def analyze(image: bytes, on_stage: Callable[[str], None] | None = None) -> dict:
    from PIL import Image

    def stage(name: str) -> None:
        if on_stage:
            on_stage(name)

    stage("preparing")
    normalized = normalize_photo(image)
    recognize, parse, enrich, catalog, recognize_line = pipeline()
    stage("reading")
    ocr = recognize(normalized)
    if not ocr["lines"]:
        raise ReceiptRecognitionError("No text was found. Try better light or a closer photo.")
    crops = receipt_crops(normalized, ocr)
    if crops:
        stage("separating")
        scans = [(crop, recognize(crop)) for crop in crops]
    else:
        scans = [(normalized, ocr)]
    stage("parsing")
    parsed = []
    for picture, reading in scans:
        draft = parse(reading)
        if crops and not draft_quality(draft)[0]:
            other = rotate_photo(picture, Image.Transpose.ROTATE_180)
            other_reading = recognize(other)
            other_draft = parse(other_reading)
            if draft_quality(other_draft) > draft_quality(draft):
                picture, reading, draft = other, other_reading, other_draft
        draft = reread_delivery_prices(picture, reading, draft, parse, recognize_line)
        draft = reread_invoice_date(picture, reading, draft, parse, recognize)
        parsed.append((picture, reading, draft))
    stage("matching")
    drafts = [
        format_draft(reread_invoice_names(picture, reading, draft, enrich, catalog, recognize))
        for picture, reading, draft in parsed if draft["items"] or draft["total_minor"] is not None
    ]
    if not drafts:
        raise ReceiptRecognitionError("No receipt items could be read. Try a closer photo of one receipt.")
    first, *additional = drafts
    if additional:
        first["additional_receipts"] = additional
    if len(drafts) < len(scans):
        first["warnings"].append("One slip could not be read. Photograph it separately for a clearer scan.")
    return first


def format_draft(draft: dict) -> dict:
    lines = []
    for kind, records in (("product", draft["items"]), ("adjustment", draft["adjustments"])):
        for row in records:
            product = row.get("product", {})
            pack = row.get("package_size")
            quantity, unit = row.get("quantity"), row.get("quantity_unit", "unit")
            if quantity is not None and pack:
                quantity = round(quantity * pack["value"], 3)
                unit = pack["unit"]
            lines.append({
                "kind": row.get("type", kind),
                "receipt_name": row["name"],
                "display_name": product.get("display_name", row["name"])[:120],
                "category": product.get("category") or row.get("spending_category") or "",
                "aliases": product.get("search_aliases", []),
                "quantity": quantity,
                "unit": unit,
                "amount_minor": row["line_total_minor"],
                "review": kind == "product" and product.get("status") != "suggested",
            })
    return {
        "store": draft["store"], "date": draft["date"], "currency": draft["currency"],
        "total_minor": draft["total_minor"], "lines": lines, "warnings": draft["warnings"],
        "spending_category": receipt_category(lines),
    }
