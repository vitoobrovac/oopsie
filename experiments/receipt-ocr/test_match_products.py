import runpy
import unittest
from pathlib import Path

matcher = runpy.run_path(str(Path(__file__).with_name("match-products.py")))


class ProductMatchingTest(unittest.TestCase):
    def setUp(self):
        self.catalog = matcher["load_catalog"]()

    def test_exact_brand_names_and_shared_bread_rule(self):
        classify = matcher["classify"]
        bread = classify("SBUDGET-TOASTBROT", self.catalog)
        self.assertEqual(bread["display_name"], "Bread")
        self.assertEqual(bread["match_method"], "exact_name")
        self.assertEqual(classify("ANOTHER BRAND TOASTBROT", self.catalog)["match_method"], "keyword")
        self.assertEqual(classify("Zott Monte White", self.catalog)["catalog_id"], "monte-white")
        self.assertEqual(classify("Zott Monte", self.catalog)["catalog_id"], "monte-dessert")
        self.assertEqual(classify("Zott Monte White XL", self.catalog)["status"], "needs_review")

    def test_product_search_and_unmatched_names(self):
        original = {"total_minor": 1234, "adjustments": [{"type": "deposit", "line_total_minor": 25}],
                    "items": [{"name": "SBUDGET TOASTBROT", "line_total_minor": 188, "quantity": 2},
                              {"name": "ZOTT MONTE WHITE", "line_total_minor": 837},
                              {"name": "UNRECOGNIZED 123", "line_total_minor": 184}]}
        result = matcher["enrich_receipt"](original, self.catalog)
        self.assertEqual(result["total_minor"], original["total_minor"])
        self.assertEqual(result["adjustments"], original["adjustments"])
        for enriched, raw in zip(result["items"], original["items"], strict=True):
            self.assertEqual({key: enriched[key] for key in raw}, raw)
        self.assertNotIn("product", original["items"][0])
        self.assertEqual(result["items"][2]["product"]["status"], "needs_review")
        self.assertEqual(result["items"][2]["product"]["display_name"], "UNRECOGNIZED 123")
        for query, expected in [("bread", "SBUDGET TOASTBROT"), ("PUddING", "ZOTT MONTE WHITE"),
                                ("zott monte", "ZOTT MONTE WHITE"), ("123", "UNRECOGNIZED 123")]:
            matches = matcher["search_items"](result["items"], query)
            self.assertEqual([item["name"] for item in matches], [expected])
