# oopsie frontend

Run `pnpm dev` in this folder to open the local app. `pnpm lint` checks the source, and `pnpm build` verifies the production build.

## Accounts and private storage

See [account setup](../ACCOUNT-SETUP.md) for the Supabase migration, Google OAuth configuration and FastAPI startup. Every page requires sign-in. Transactions and the reporting day are stored in the account's Supabase PostgreSQL database through FastAPI.

## Transactions and reporting periods

Open **Add transaction → Add manually** on Overview or Activity. The description and EUR amount are required. The date defaults to today and the category and merchant or payer are optional. Amounts are stored as whole cents.

**Settings → Reporting period** sets the start day (1–31). Short months use the last available day. **Left this period** equals recorded income minus expenses through today. Activity can delete a saved transaction after confirmation. Deleting an expense created from a receipt also removes the receipt and its product history.

**Receipts → Scan a receipt** runs OCR and opens a review form. Confirming creates one expense and stores the receipt lines. Product search uses friendly names, receipt labels, categories and aliases. Product prices are shown before receipt-level discounts. Store comparisons require quantities in the same unit at two or more stores.
