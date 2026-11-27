"""Add friendly product names to a parsed receipt without changing its prices."""

import argparse
import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

LAB = Path(__file__).resolve().parent


@lru_cache(maxsize=4096)
def normalize(text: str) -> str:
    """Make capitalization, accents and punctuation irrelevant for matching."""
    decomposed = unicodedata.normalize("NFKD", text.casefold())
    plain = "".join(char for char in decomposed if not unicodedata.combining(char))
    return " ".join(re.findall(r"[^\W_]+", plain))


def load_catalog() -> list[dict]:
    return json.loads((LAB / "product_catalog.json").read_text(encoding="utf-8"))


def classify(receipt_name: str, catalog: list[dict]) -> dict:
    label = normalize(receipt_name)
    padded_label = f" {label} "
    best = None
    best_length = 0
    for product in catalog:
        for alias in product.get("receipt_names", []):
            if label == normalize(alias):
                return match_details(product, "exact_name", alias)
        for keyword in product.get("receipt_keywords", []):
            phrase = normalize(keyword)
            if len(phrase) > best_length and f" {phrase} " in padded_label:
                best = match_details(product, "keyword", keyword)
                best_length = len(phrase)

    return best if best is not None else {
        "status": "needs_review",
        "catalog_id": None,
        "display_name": receipt_name,
        "type": None,
        "category": None,
        "search_aliases": [],
        "match_method": None,
        "matched_rule": None,
    }


def match_details(product: dict, method: str, rule: str) -> dict:
    return {
        "status": "suggested",
        "catalog_id": product["id"],
        "display_name": product["display_name"],
        "type": product["type"],
        "category": product["category"],
        "search_aliases": product["search_aliases"],
        "match_method": method,
        "matched_rule": rule,
    }


def enrich_receipt(draft: dict, catalog: list[dict]) -> dict:
    if not isinstance(draft, dict) or not isinstance(draft.get("items"), list):
        raise ValueError("Expected parsed receipt JSON with an items array.")
    items = []
    for item in draft["items"]:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str) or not item["name"].strip():
            raise ValueError("Every receipt item must have its original name.")
        items.append({**item, "product": classify(item["name"], catalog)})
    return {**draft, "items": items}


def search_items(items: list[dict], query: str) -> list[dict]:
    terms = normalize(query).split()
    if not terms:
        return []
    matches = []
    for item in items:
        product = item["product"]
        labels = [item["name"], product["display_name"], product["type"] or "",
                  product["category"] or "", *product["search_aliases"]]
        tokens = set(normalize(" ".join(labels)).split())
        if all(term in tokens for term in terms):
            matches.append(item)
    return matches


def save_result(source: Path, receipt: dict) -> Path:
    directory = LAB / "results"
    directory.mkdir(exist_ok=True)
    attempt = 1
    while True:
        suffix = "" if attempt == 1 else f"-{attempt}"
        output = directory / f"{source.stem}-products{suffix}.json"
        try:
            with output.open("x", encoding="utf-8") as handle:
                json.dump(receipt, handle, indent=2, ensure_ascii=False)
                handle.write("\n")
            return output
        except FileExistsError:
            attempt += 1


def print_search(receipt: dict, query: str) -> None:
    matches = search_items(receipt["items"], query)
    if not matches:
        print(f'No products match "{query}".')
    for item in matches:
        price = item.get("line_total_minor")
        currency = receipt.get("currency") or ""
        if price is None:
            amount = "price needs review"
        else:
            whole, cents = divmod(abs(price), 100)
            amount = f"{'-' if price < 0 else ''}{whole}.{cents:02d} {currency}".strip()
        print(f"{item['product']['display_name']} | {amount}")
        print(f"  Receipt: {item['name']}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("draft_json", type=Path, help="A JSON draft from parse-receipt.py")
    parser.add_argument("--search", help="Preview search matches in the terminal without writing a file")
    args = parser.parse_args()
    try:
        draft = json.loads(args.draft_json.read_text(encoding="utf-8"))
        result = enrich_receipt(draft, load_catalog())
        if args.search is not None:
            print_search(result, args.search)
        else:
            output = save_result(args.draft_json, result)
            suggested = sum(item["product"]["status"] == "suggested" for item in result["items"])
            print(f"Saved product draft to: {output}")
            print(f"Suggested names: {suggested} | Needs review: {len(result['items']) - suggested}")
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f"Could not match products: {error}\n")


if __name__ == "__main__":
    main()
