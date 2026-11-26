"""Map detailed receipt labels to the small set used by spending reports."""

from collections import Counter

EXPENSE_CATEGORIES = (
    "Groceries", "Dining out", "Entertainment", "Music & instruments", "Subscriptions",
    "Transport", "Travel", "Education", "Tools", "Housing", "Shopping", "Health",
    "Business", "Yearly expenses", "Other",
)

PRODUCT_CATEGORIES = {
    **{category.casefold(): category for category in EXPENSE_CATEGORIES},
    **dict.fromkeys(("bakery", "dairy", "dairy desserts", "drinks", "eggs", "fish & seafood", "fruit",
                    "fresh fruit", "meat", "pantry", "shopping supplies", "snacks", "vegetables"), "Groceries"),
    "dinner": "Dining out",
    "fun": "Entertainment",
}


def receipt_category(lines: list[dict]) -> str:
    totals: Counter[str] = Counter()
    for line in lines:
        if line["kind"] != "product" or line.get("display_name", "").casefold() == "shipping":
            continue
        category = PRODUCT_CATEGORIES.get((line.get("category") or "").strip().casefold())
        if category and category != "Other":
            totals[category] += max(0, line["amount_minor"] or 0)
    if not totals:
        return "Other"
    category, _ = max(totals.items(), key=lambda pair: (pair[1], pair[0]))
    return category
