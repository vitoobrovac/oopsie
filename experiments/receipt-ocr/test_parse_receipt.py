import runpy
import unittest
from pathlib import Path

parse_receipt = runpy.run_path(str(Path(__file__).with_name("parse-receipt.py")))["parse_receipt"]


def line(text, x, y, width):
    return {"text": text, "confidence": 98,
            "polygon": [[x, y], [x + width, y], [x + width, y + 20], [x, y + 20]]}


def draft(*body):
    return parse_receipt({"engine": "test", "lines": [
        line("MARKET TEST", 30, 20, 220),
        line("01.10.2026 14:25", 30, 65, 180),
        line("EUR", 360, 91, 35),
        *body,
        line("SUMME:", 25, 320, 85),
        line("3,50", 350, 323, 50),
    ]})


class ParserTest(unittest.TestCase):
    def test_matches_shifted_prices_and_keeps_discount_separate(self):
        result = draft(
            line("PEARS 500G", 25, 125, 150),
            line("2", 28, 148, 10),
            line("1,00", 90, 148, 39),
            line("2,00 B", 350, 142, 52),
            line("JUICE 1L", 25, 185, 145),
            line("2,00 A", 350, 201, 50),
            line("Rabatt", 25, 235, 80),
            line("-0,50", 350, 244, 55),
        )
        self.assertEqual(result["store"], "MARKET TEST")
        self.assertEqual(result["date"], "2026-10-01")
        self.assertEqual(result["total_minor"], 350)
        self.assertTrue(result["reconciliation"]["matches_printed_total"])
        self.assertEqual([item["line_total_minor"] for item in result["items"]], [200, 200])
        self.assertEqual(result["items"][0]["package_size"], {"value": 0.5, "unit": "kg"})
        self.assertEqual(result["items"][0]["quantity"], 2)
        self.assertEqual(result["adjustments"][0]["type"], "discount")
        self.assertEqual(result["adjustments"][0]["line_total_minor"], -50)

    def test_missing_price_is_left_blank(self):
        result = draft(line("PEARS", 25, 125, 100), line("JUICE", 25, 200, 90),
                       line("2,00", 350, 201, 50))
        self.assertIsNone(result["items"][0]["line_total_minor"])
        self.assertEqual(result["items"][1]["line_total_minor"], 200)
        self.assertFalse(result["reconciliation"]["matches_printed_total"])
        self.assertTrue(any("No reliable line price" in warning for warning in result["warnings"]))

    def test_empty_input_does_not_invent_data(self):
        result = parse_receipt({"lines": []})
        self.assertEqual(result["items"], [])
        self.assertIsNone(result["total_minor"])
        self.assertEqual(result["status"], "needs_review")
