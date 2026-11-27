"""Scan local receipt photos with the app pipeline and check labeled examples."""

import argparse
import json
import sys
from pathlib import Path
from time import perf_counter

LAB = Path(__file__).resolve().parent
sys.path.insert(0, str(LAB.parents[1] / "backend"))
from receipt_pipeline import ReceiptRecognitionError, analyze


def check(draft, expected):
    actual = {field: draft[field] for field in ("store", "date", "currency", "total_minor", "spending_category")}
    actual["lines"] = [[line["display_name"], line["amount_minor"]] for line in draft["lines"]]
    actual["review_count"] = sum(line["review"] for line in draft["lines"])
    if "weights_kg" in expected:
        actual["weights_kg"] = {
            line["display_name"]: line["quantity"] for line in draft["lines"] if line["unit"] == "kg"
        }
    if actual["store"] and expected["store"]:
        actual["store"] = actual["store"].casefold()
        expected = {**expected, "store": expected["store"].casefold()}
    return [field for field, value in expected.items() if actual.get(field) != value]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--all", action="store_true", help="Also scan unlabeled photos in the photos folder")
    args = parser.parse_args()
    expected = json.loads((LAB / "receipt-expectations.json").read_text(encoding="utf-8"))
    folder = LAB / "photos"
    files = [folder / name for name in expected]
    if args.all:
        files.extend(path for path in sorted(folder.iterdir())
                     if path.suffix.lower() in {".png", ".jpeg", ".jpg", ".webp"} and path.name not in expected)
    failures = 0
    for path in files:
        start = perf_counter()
        baseline = expected.get(path.name)
        try:
            draft = analyze(path.read_bytes())
        except (OSError, ReceiptRecognitionError, ValueError) as error:
            print(f"{path.name}: {type(error).__name__}", flush=True)
            failures += baseline is not None
            continue
        changes = check(draft, baseline) if baseline else []
        failures += bool(changes)
        result = "DIFF " + ", ".join(changes) if changes else "PASS" if baseline else "unlabeled"
        slips = [draft, *draft.get("additional_receipts", [])]
        balanced = sum(
            slip["total_minor"] is not None
            and all(line["amount_minor"] is not None for line in slip["lines"])
            and sum(line["amount_minor"] for line in slip["lines"]) == slip["total_minor"]
            for slip in slips
        )
        print(f"{path.name}: {result}, {balanced}/{len(slips)} totals match, {perf_counter()-start:.1f}s", flush=True)
    print(f"{len(expected) - failures}/{len(expected)} labeled examples passed.")
    return int(failures > 0)


if __name__ == "__main__":
    sys.exit(main())
