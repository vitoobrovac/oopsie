"""Adapter from a local receipt photo to an editable, unsaved draft."""

import runpy
from functools import lru_cache
from io import BytesIO
from pathlib import Path

LAB = Path(__file__).resolve().parents[1] / "experiments" / "receipt-ocr"
SCAN_SIDE = 1800


@lru_cache(maxsize=1)
def pipeline():
    scanner = runpy.run_path(str(LAB / "read-rapidocr.py"))
    parser = runpy.run_path(str(LAB / "parse-receipt.py"))
    matcher = runpy.run_path(str(LAB / "match-products.py"))
    return scanner["recognize_bytes"], parser["parse_receipt"], matcher["enrich_receipt"], matcher["load_catalog"]()


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


def analyze(image: bytes) -> dict:
    normalized = normalize_photo(image)
    recognize, parse, enrich, catalog = pipeline()
    ocr = recognize(normalized)
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
