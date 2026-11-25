# Connect sign-in and the private ledger

The app requires sign-in. Transactions and the reporting start day are stored in Supabase for the signed-in account. Older guest entries are stored in their original browser and are no longer shown in the app.

## Enable receipt scanning

In Supabase SQL Editor, copy the **contents** of `supabase/migrations/002_private_receipts.sql` and run it once. On a new project, run migration 001 first. Migration 002 adds private receipts, product lines and remembered labels.

Install the updated `backend/requirements.txt` and restart FastAPI. The API runs PaddleOCR on JPEG, PNG or WebP photos up to 10 MB. Its first scan may download the free models. The photo is used during processing and review. The confirmed receipt and product lines are stored in Supabase.

In oopsie, open **Receipts → Scan a receipt**. Upload a photo, review the draft and select **Confirm and save**. Keep **Remember this name and category** checked for corrections you want reused for the same printed product label at that store. The confirmed receipt and its ledger expense are saved together.

Recognized lines show a compact summary. Tap **Edit** when a suggestion is wrong. When a label is unrecognized, provide a product name and category. Oopsie remembers the answer for the signed-in account and the same store on confirmation.

For a phone, open an accessible app URL over HTTPS and allow the corresponding return URL in Supabase Auth. By default the frontend forwards API requests through its own origin. When deploying separately, set `LUMA_API_PROXY_URL` on the frontend to the backend address, or configure the public API URL and matching CORS origin described below.

## 1. Prepare Supabase

1. Create a Supabase project. Copy its **Project URL** and **publishable key** from the project’s Connect dialog.
2. Open SQL Editor and run `supabase/migrations/001_private_ledger.sql` once. It creates the ledger and preferences tables. Row Level Security limits reads, writes, and deletes to the signed-in owner.
3. In Authentication → URL Configuration, set the Site URL to `http://localhost:3000` and allow `http://localhost:3000/` as a Redirect URL. Add the deployed frontend's exact URL when you publish.
4. Keep confirmation enabled for email sign-up. Open the confirmation link in the same browser profile that started sign-up. Supabase's default email sender is intended for testing and restricts who can receive messages. Configure custom SMTP before inviting real users.

## 2. Enable Google

In Google Cloud, configure the consent screen and create a **Web application** OAuth client. Add the Supabase provider callback, shown under Authentication → Providers → Google, to the client's **Authorized redirect URIs**. It usually looks like `https://<project-ref>.supabase.co/auth/v1/callback`. In Supabase, enable Google and enter the Google Client ID and Client Secret there. Use Google test users if your OAuth app is in testing.

[Supabase guide for Google sign-in](https://supabase.com/docs/guides/auth/social-login/auth-google)

## 3. Run the frontend and API

Copy `frontend/.env.example` to `frontend/.env.local`. Fill in the project URL and publishable key. Keep the API URL at `http://localhost:8000` for local development. Restart the frontend with `pnpm dev` from `frontend` to load the new configuration.

Install Python if needed. In a second PowerShell terminal, open `backend` and run the following. The commands create a Python environment in the project, install its dependencies, and start FastAPI. Replace the two example values with your Supabase values.

```powershell
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_PUBLISHABLE_KEY = "<publishable-key>"
.\.venv\Scripts\python.exe -m uvicorn main:app --host localhost --port 8000
```

The publishable key identifies your project. The signed-in user's token identifies the account and enforces row ownership. The Google Client Secret belongs only in Supabase, and this app does not need a Supabase service-role key.

When deploying the API, set `LUMA_WEB_ORIGIN` to the frontend's exact origin. Set `NEXT_PUBLIC_LUMA_API_URL` to the public HTTPS URL of the deployed API.

## 4. Verify with two accounts

Sign in with account A. Add an expense and an income, change the reporting start day, refresh, and check that all three changes persist. Sign in with account B in a separate browser profile and check that it starts with an empty ledger and its own reporting day. Delete a test entry in account A and verify it stays deleted after refresh. Try email confirmation and Google sign-in separately.

## Before an online beta

- Deploy the Next.js frontend and an always-available FastAPI service behind HTTPS. The API host needs CPU and memory for OCR, the Python dependencies, and the receipt lab source and model files. Confirm production redirect URLs and run both migrations against the intended database.
- On the public URL, test sign-in, camera and gallery upload, review, repeat-scan corrections, and data isolation with two real accounts. Test on Android Chrome and iPhone Safari, with several receipt formats. Include slow connections, unsupported formats and incorrect OCR totals.
- Before public signups, implement and test email password recovery, account deletion and a data export. Configure production email delivery and Google consent, and explain in the app what financial information is stored.
- Add OCR rate limits, service monitoring, a backup and restore procedure, and a staging environment for testing future migrations. Keep photos, OCR text and access tokens out of operational logs.

[Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) · [Next.js hosting guide](https://nextjs.org/docs/app/guides/self-hosting)

## Publish a small private beta on Render

1. Push this project to a **private GitHub repository**. Review the files about to be committed. Include the app, scanner code and catalog, and SQL migrations. Keep your environment files, local dependencies, receipt photos, and OCR results on your computer.
2. In Render, connect that repo to two Web Services. The API uses the **repository root** because it needs both `backend` and `experiments/receipt-ocr`. The website uses `frontend`.

   | Setting | Website | OCR API |
   | --- | --- | --- |
   | Runtime | Node, set `NODE_VERSION=24` | Python, set `PYTHON_VERSION=3.12.16` |
   | Root Directory | `frontend` | Leave blank |
   | Build Command | `npx --yes pnpm@11.25.0 install --frozen-lockfile && npx --yes pnpm@11.25.0 build` | `python -m pip install -r backend/requirements.txt` |
   | Start Command | `node node_modules/next/dist/bin/next start -H 0.0.0.0` | `python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port $PORT` |

   Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_LUMA_API_URL` on the website. Use the API's Render HTTPS URL for the last value. On the API set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `LUMA_WEB_ORIGIN`, with the website's HTTPS origin for the last value. Redeploy the frontend after changing public environment variables.
3. Apply migrations 001 and 002 in order if this is a fresh Supabase project. Add the website's HTTPS URL as the Supabase Auth Site URL and an allowed redirect. In Google Cloud add the live website origin to the OAuth client and keep the Supabase callback under Authorized redirect URIs.
4. Set up and verify the few tester accounts first. In Supabase Auth, turn off **Allow new users to sign up** before sharing the link. Existing accounts can still sign in, including your own. Verify that an account outside your tester list cannot create a new account.
5. On the HTTPS URL, test signing in, scanning a receipt, fixing one name, saving, and finding the item on your phone. Verify that a second account sees only its own ledger. A free API web service can go idle. Allow for a slow first scan and check memory use with real receipt photos.

[Render Next.js guide](https://render.com/docs/deploy-nextjs-app) · [Render FastAPI guide](https://render.com/docs/deploy-fastapi) · [Supabase sign-up settings](https://supabase.com/docs/guides/auth/general-configuration)
