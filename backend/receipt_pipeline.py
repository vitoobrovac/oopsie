"""Adapter from a local receipt photo to an editable, unsaved draft."""

import runpy
from functools import lru_cache
from io import BytesIO
from pathlib import Path

LAB = Path(__file__).resolve().parents[1] / "experiments" / "receipt-ocr"


@lru_cache(maxsize=1)
def pipeline():
    scanner = runpy.run_path(str(LAB / "read-rapidocr.py"))
    parser = runpy.run_path(str(LAB / "parse-receipt.py"))
    matcher = runpy.run_path(str(LAB / "match-products.py"))
    return scanner["recognize_bytes"], parser["parse_receipt"], matcher["enrich_receipt"], matcher["load_catalog"]()


def analyze(image: bytes) -> dict:
    from PIL import Image, ImageOps, UnidentifiedImageError

    try:
        with Image.open(BytesIO(image)) as source:
            if source.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("Choose a JPEG, PNG, or WebP receipt photo.")
            if source.width * source.height > 52_000_000:
                raise ValueError("This photo is too large. Try a smaller copy.")
            oriented = ImageOps.exif_transpose(source).convert("RGB")
            oriented.thumbnail((2400, 2400))
            normalized = BytesIO()
            oriented.save(normalized, format="JPEG", quality=94)
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as exc:
        raise ValueError("This photo could not be read. Try a JPEG or PNG.") from exc

    recognize, parse, enrich, catalog = pipeline()
    ocr = recognize(normalized.getvalue())
    if not ocr["lines"]:
        raise ValueError("No text was found. Try better light or a closer photo.")
    draft = enrich(parse(ocr), catalog)
    lines = []
    for kind, records in (("product", draft["items"]), ("adjustment", draft["adjustments"])):
        for row in records:
            product = row.get("product", {})
            pack = row.get("package_size")
            quantity, unit = row.get("quantity"), "unit"
            if quantity is not None and pack:
                quantity = round(quantity * pack["value"], 3)
                unit = pack["unit"]
            lines.append({
                "kind": row.get("type", kind),
                "receipt_name": row["name"],
                "display_name": product.get("display_name", row["name"]),
                "category": product.get("category") or "",
                "aliases": product.get("search_aliases", []),
                "quantity": quantity,
                "unit": unit,
                "amount_minor": row["line_total_minor"],
                "review": kind == "product" and product.get("status") != "suggested",
            })
    return {
        "store": draft["store"], "date": draft["date"], "currency": draft["currency"],
        "total_minor": draft["total_minor"], "lines": lines, "warnings": draft["warnings"],
    }
