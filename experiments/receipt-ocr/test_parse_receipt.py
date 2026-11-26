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

    def test_table_header_and_payment_are_not_products(self):
        result = parse_receipt({"lines": [
            line("Grocero", 30, 20, 100),
            line("Description", 30, 59, 200),
            line("$", 360, 55, 12),
            line("Wholemeal bread 700g", 30, 105, 198),
            line("2.80", 355, 98, 45),
            line("Bananas per kg", 30, 145, 130),
            line("2.68", 355, 140, 45),
            line("TOTAL (3 items)", 30, 200, 145),
            line("4.00", 355, 197, 45),
            line("EFTPOS", 30, 235, 80),
            line("4.00", 355, 232, 45),
        ]})
        self.assertEqual(result["store"], "Grocero")
        self.assertIsNone(result["date"])
        self.assertEqual(result["currency"], "$")
        self.assertEqual([item["name"] for item in result["items"]], ["Wholemeal bread 700g", "Bananas per kg"])
        self.assertEqual(result["items"][0]["package_size"], {"value": 0.7, "unit": "kg"})
        self.assertEqual(result["items"][0]["quantity"], 1)
        self.assertIsNone(result["items"][1]["quantity"])
        self.assertEqual(result["total_minor"], 400)
        self.assertEqual(result["reconciliation"]["matched_total_minor"], 548)
        self.assertFalse(result["reconciliation"]["matches_printed_total"])

    def test_online_order_pairs_currency_prefixed_prices_and_skips_summary(self):
        result = parse_receipt({"lines": [
            line("Thomann", 25, 15, 88),
            line("Dear customer,", 25, 45, 120),
            line("Items ordered", 25, 75, 100),
            line("1x Yamaha TRBX 174 OVS", 100, 110, 200),
            line("Item no. 329076", 100, 128, 100),
            line("€239.00", 420, 130, 65),
            line("2x Instrument Cable", 100, 172, 190),
            line("Item no. 591811", 100, 192, 100),
            line("€14.90", 420, 190, 65),
            line("Merchandise value", 315, 235, 110),
            line("€253.90", 420, 235, 75),
            line("Net amount", 315, 260, 85),
            line("€211.58", 420, 260, 75),
            line("Total amount", 315, 290, 110),
            line("€253.90", 420, 290, 75),
            line("Order date", 25, 365, 70),
            line("15.05.2026", 155, 365, 75),
        ]})
        self.assertEqual(result["store"], "Thomann")
        self.assertEqual(result["date"], "2026-05-15")
        self.assertEqual(result["currency"], "EUR")
        self.assertEqual(result["total_minor"], 25390)
        self.assertTrue(result["reconciliation"]["matches_printed_total"])
        self.assertEqual([item["quantity"] for item in result["items"]], [1, 2])
        self.assertEqual([item["line_total_minor"] for item in result["items"]], [23900, 1490])

    def test_empty_input_does_not_invent_data(self):
        result = parse_receipt({"lines": []})
        self.assertEqual(result["items"], [])
        self.assertIsNone(result["total_minor"])
        self.assertEqual(result["status"], "needs_review")
