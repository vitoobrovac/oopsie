# oopsie receipt OCR lab

The scanner runs PaddleOCR's PP-OCRv5 English model locally through RapidOCR. Use --model latin for the optional mixed-language model. Photos and results stay on this computer.

## Scan, then parse

Run these commands from the lab folder. The first saves OCR text and positions. The second turns that file into a receipt draft.

    $python = "C:\Users\goran\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    & $python .\read-rapidocr.py .\photos\racun_2.jpeg
    & $python .\parse-receipt.py .\results\racun_2-ppocrv5-english.json

Use the exact OCR path printed by the scanner. Repeat scans and parses get numbered filenames. To set up the scanner on another computer, run python -m pip install -r requirements-rapidocr.txt. The parser uses only the Python standard library.

The parser uses the center of each OCR polygon to separate the name and amount columns. It matches them in order using vertical distance and the sign of the amount. It reads the store, date, currency and total, and keeps discounts and deposits separate from merchandise. Amounts are integer cents. Unknown quantities stay blank, and inferred quantities are marked. A matching total helps catch errors, and the draft still needs review. Nothing is written to the oopsie database.

## Add friendly product names

The third step reads the parsed draft and adds a product section to each item. Run these commands in the same terminal after setting $python above:

    & $python .\match-products.py .\results\racun_2-ppocrv5-english-parsed.json
    & $python .\match-products.py .\results\racun_2-ppocrv5-english-parsed.json --search bread
    & $python .\match-products.py .\results\racun_2-ppocrv5-english-parsed.json --search pudding

The first command saves a new JSON file ending in -products.json. The searches only print a small preview. Each result shows the friendly name, line price before discounts, and original receipt name.

The editable dictionary is **product_catalog.json**. An exact receipt name wins first, then a known word or phrase can suggest a match. Search uses the friendly name, original name, category, and aliases. Unknown labels keep the original text and get the status **needs_review**. The matcher leaves the parser's prices, quantities, adjustments, and totals unchanged. Suggestions still need review and stay in the lab.

## Engine comparison

Both photos show the same receipt. Amounts were scored as exact numeric tokens in the right-hand column, counting duplicates and checking the sign. Decimal dots and commas are equivalent. The printed grand total was scored separately.

| Engine and model | Angle 1 amounts | Angle 2 amounts | Grand total correct |
| --- | --- | --- | --- |
| PaddleOCR PP-OCRv5 English | 16/16 | 16/16 | Both angles |
| Tesseract English | 1/16 | 6/16 | Neither angle |
| Tesseract German | 1/16 | 4/16 | Angle 2 |

PaddleOCR also read the store and date on both photos. The parser matched all 13 purchase lines and 3 adjustments from each photo and reconciled both drafts to the printed total. This comparison establishes a winner for these two photos of one receipt. Other stores and layouts need their own checks.
## Check scanned receipts

From the repository root, with the same Python environment used by the app, run:

```powershell
python experiments/receipt-ocr/check_receipts.py --all
```

This runs the app’s image-to-draft pipeline locally and reports how long each scan takes, whether the amounts reconcile, and which expected fields differ. Drop `--all` to run just the five labeled examples. The checker exits with a failure if a labeled photo is missing or differs from its expected result. Add verified expectations to `receipt-expectations.json` as you add samples. The photos and OCR outputs stay local.
