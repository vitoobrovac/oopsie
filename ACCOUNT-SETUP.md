# Connect sign-in and the private ledger

The app requires sign-in. Transactions and the reporting start day are stored in Supabase for the signed-in account. Older guest entries are stored in their original browser and are no longer shown in the app.

## Enable receipt scanning

In Supabase SQL Editor, copy the **contents** of `supabase/migrations/002_private_receipts.sql` and run it once. On a new project, run migration 001 first. Migration 002 adds private receipts, product lines and remembered labels.

Install the updated `backend/requirements.txt` and restart FastAPI. The API runs PaddleOCR on JPEG, PNG or WebP photos up to 10 MB. Its first scan may download the free models. The photo is used during processing and review. The confirmed receipt and product lines are stored in Supabase.

In oopsie, open **Receipts → Scan a receipt**. Upload a photo, review the draft and select **Confirm and save**. Keep **Remember this name and category** checked for corrections you want reused for the same printed product label at that store. The confirmed receipt and its ledger expense are saved together.

Apply migration 012 to save newly scanned receipts under one of 15 spending categories. Oopsie suggests a category from the recognized items, and you can change it under **Edit receipt details → Spending category**. Product types such as Bakery and Fruit remain available in product search and roll up to Groceries in the ledger. Previously saved receipts keep their original spending categories.

The scanner runs RapidOCR and Python parsing code on the backend. The shared product catalog is a JSON file in the repository. Supabase stores each signed-in user’s confirmed receipts, purchases, and remembered corrections. The scanner handles common invoice columns, VAT, payment summaries, and sideways paper slips. Check flagged amounts and labels against the original before saving.

While scanning, the progress bar reports completed pipeline stages. It reaches 100% once an editable draft is ready. If a sideways photo has clearly separated receipt headings, oopsie can read the slips separately and lets you review and save each one. Unreadable prices stay flagged for review. Saving the final receipt closes the review and returns to the receipt list. The next scan starts with a blank form.

Recognized lines show a compact summary. The scanner separates column headers from product rows, checks the sum against the printed total, and uses a shared catalog to suggest names and categories. Select the receipt's currency when it differs from EUR. oopsie shows the latest published European Central Bank reference rate and the converted total, then saves reconciled EUR amounts. A bare dollar symbol requires a currency choice. The original amounts are shown in the draft and the saved receipt contains EUR amounts. Tap **Edit** when a suggestion is wrong. When a label is unrecognized, provide a product name and category. Oopsie remembers the answer for the signed-in account and the same store on confirmation.

For a phone, open an accessible app URL over HTTPS and allow the corresponding return URL in Supabase Auth. By default the frontend forwards API requests through its own origin. When deploying separately, set `LUMA_API_PROXY_URL` on the frontend to the backend address, or configure the public API URL and matching CORS origin described below.

### Receipt scan feedback

Apply migration 009 to enable the private `receipt-scan-feedback` bucket. Oopsie offers feedback when a scan has three or more unidentified products or unreadable prices, leaves at most two identified items on an incomplete receipt, or finds no usable items. The original image is uploaded only when the signed-in user chooses **Send photo for review**. They can still correct or enter the receipt themselves.

In the Supabase project dashboard, open **Storage → receipt-scan-feedback** to review submitted images. Use the Storage dashboard to delete photos after reviewing them. Keep the bucket private. Use de-identified receipt details or synthetic examples when updating the parser and catalog, and keep customer photos out of Git and shared test fixtures.

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

## Profile and display settings

In Settings, save a display name to see it on Overview and in the Account menu. The display name is stored with the signed-in Supabase account. Save a different reporting start day to change the monthly periods used by budgets and reports. The Reduce motion toggle saves in the current browser and switches the wallet and transition animations off. The app also respects the device's reduced-motion preference.

The **First day of the week** setting defaults to Monday and is saved with the Supabase account. The Overview’s weekly chart covers the current week from the selected weekday through today. In Receipts, select the same receipt again or use **Close receipt** to close its details.

In **Products**, select an item to compare average prices across stores. Each chart compares the same unit, and the average uses the total price divided by the total quantity at that store. If quantities are missing and there is no unit comparison, the chart can compare the average amount per receipt line and labels it accordingly.

## Guided Oopsie AI

Open **Insights → Ask Oopsie AI**. The assistant calculates answers in the browser from the signed-in account’s existing ledger and receipts. Savings targets, spending reduction examples, summaries, and period comparisons use the reporting period in Settings. The receipt-specific answer unlocks after ten saved receipts. The app counts all saved receipts, including manual entries. The guide requires no model, external AI requests, or database migration.

## Enable Oopsie Hunt

Apply migrations 007 through 011 in order, then restart or deploy the API. Open the four-square menu and select Oopsie Hunt. New and existing accounts receive a stable player ID. Players pick a unique username in Settings before they can enter the lobby. The lifetime leaderboard shares usernames, XP, levels, and rank. Receipts and ledger records remain private.

Permanent challenges include Receipt Archivist, Receipt Regular, Income Tracker, Budget Builder, Weekly Warrior, Consistent Hunter, and Variety Hunter. Each tier can be claimed once. Level 2 starts at 20 lifetime XP, Level 3 at 55, and Level 4 at 105. Each step costs 15 XP more than the previous step. Existing players keep at least their previously earned level. Saved receipts count toward the date and month milestones. Players can join the current weekly Hunt once to earn participation progress. Existing receipt, income, and budget records count, and deleting a record later keeps the milestone. Challenges that require verified scans or scored results appear under **Upcoming challenges** until their event sources are available. Permanent awards only enter the lifetime XP ledger, which also supports future weekly XP payouts.

An unclaimed reward appears as a number on the four-square menu and beside **Oopsie Hunt**. Claim and unlock messages dismiss after four seconds. Badges stay visible until the rewards are claimed.

The Overview chart gives the selected week seven days, the configured monthly reporting period one point per day, and the calendar year twelve months. Future dates remain visible as upcoming.

The migration seeds four weekly briefings from the current Monday in Europe/Berlin. Future briefings can be added to the private hunt_weeks table by a database administrator. This release covers the lobby and onboarding. Competitive receipt verification, scoring, and rankings need their own implementation before awarding points.

## 4. Verify with two accounts

Sign in with account A. Add an expense and an income, change the reporting start day, refresh, and check that all three changes persist. Sign in with account B in a separate browser profile and check that it starts with an empty ledger and its own reporting day. Delete a test entry in account A and verify it stays deleted after refresh. Try email confirmation and Google sign-in separately.

## Test budgets, goals and subscriptions in development

Budgets, Goals and Subscriptions use the FastAPI service and Supabase by default, including on localhost. Restart FastAPI after pulling changes so that it loads the planning endpoints. Open the API’s `/docs` page to verify that `/v1/planning/{plan}` is available.

For an isolated browser preview, set `NEXT_PUBLIC_PLANNING_STORAGE=preview` in `frontend/.env.local` and restart Next.js in development mode. This also lets you view any previous preview records stored in that browser. Preview records are scoped to the signed-in account. Due preview subscriptions appear in the local ledger when you open the app or return to the tab. Clearing browser data removes the preview plans. Normal transactions and receipts continue to use the configured API. Production builds always use the API and Supabase.

1. Use a separate Supabase test project or your local Supabase stack. In a fresh test database, run migrations 001 through 012 in order. In the dashboard SQL editor, paste the contents of each file and run it.
2. Set the Supabase URL and publishable key in both your local API and frontend to the test project's values. Set the frontend API URL to http://localhost:8000 and restart both development servers. Create a test login and open http://localhost:3000.
3. Open the four-square menu. In Budgets, set a Groceries limit and create a grocery transaction to see it update. In Goals, create a target and set Saved so far. In Subscriptions, add a weekly or monthly expense due today and check Transactions. Reload and verify there is still only one entry for today. You can pause or delete a schedule while keeping its recorded expenses.

Subscription dates use Europe/Berlin. Weekly schedules use the same weekday. Monthly schedules keep the original day and move to the last day in shorter months. Yearly schedules can record the annual amount on the same date each year, or spread it across 12 monthly ledger entries from the chosen start date. A February 29 anniversary uses February 28 in shorter years. If the annual amount does not divide evenly, the earliest entries get the extra cents so the total is exact. Apply migration 004 for yearly schedules and 005 for the separate Yearly expenses ledger category. Migration 005 categorizes newly posted entries. Previously recorded entries keep their saved categories. Resuming a paused schedule skips occurrences during the pause. A schedule can use an older date as its anchor, and starts posting with its next due date. The API also catches up due payments when the ledger or subscriptions are loaded.

To post due payments even with the app closed, enable Supabase Cron under Integrations on the target database. Then run this in that project's SQL Editor. The named job checks for payments every hour and uses the database posting record to avoid duplicates.

~~~sql
select cron.schedule(
  'oopsie-post-subscriptions',
  '5 * * * *',
  $$select oopsie_private.post_due_subscriptions(null, timezone('Europe/Berlin', now())::date)$$
);
~~~

[Supabase Cron quickstart](https://supabase.com/docs/guides/cron/quickstart)

## Before an online beta

- Deploy the Next.js frontend and an always-available FastAPI service behind HTTPS. The API host needs CPU and memory for OCR, the Python dependencies, and the receipt lab source and model files. Confirm production redirect URLs and run the migrations against the intended database.
- On the public URL, test sign-in, camera and gallery upload, review, repeat-scan corrections, and data isolation with two real accounts. Test on Android Chrome and iPhone Safari, with several receipt formats. Include slow connections, unsupported formats and incorrect OCR totals.
- Before public signups, implement and test email password recovery, account deletion and a data export. Configure production email delivery and Google consent, and explain in the app what financial information is stored.
- Add OCR rate limits, service monitoring, a backup and restore procedure, and a staging environment for testing future migrations. Keep photos, OCR text and access tokens out of operational logs.

[Supabase production checklist](https://supabase.com/docs/guides/deployment/going-into-prod) · [Next.js hosting guide](https://nextjs.org/docs/app/guides/self-hosting)

## Move the website to a Render Static Site

Open [Oopsie’s static website](https://oopsie-static.onrender.com/) on your phone. Replace any bookmark or home-screen shortcut that opens the old Render web service or the API address. The static site serves the app’s HTML, JavaScript and CSS as soon as the browser connects.

The separate FastAPI service still handles private data and OCR. If it uses Render’s free compute, it can go to sleep while idle. Oopsie shows its own loading state and retries reads during startup. To eliminate that API wake-up delay, switch the API service to compute that stays on. [Render’s free service behavior](https://render.com/docs/free#spinning-down-on-idle)

Create the static site alongside the existing website so current testers can keep using the old link during verification. Keep the existing FastAPI Web Service and Supabase project.

1. Push the latest code. In Render choose **New → Static Site**, connect the repository and select the same branch as your existing services.
2. Enter these settings.

   | Setting | Value |
   | --- | --- |
   | Root Directory | `frontend` |
   | Build Command | `npx --yes pnpm@11.25.0 install --frozen-lockfile && npx --yes pnpm@11.25.0 build` |
   | Publish Directory | `out` |
   | Environment variables | `NODE_VERSION=24`, `OOPSIE_STATIC_EXPORT=1`, plus the three public variables below |

   Copy `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from the existing website in Render. Set `NEXT_PUBLIC_LUMA_API_URL` to the public HTTPS address of your existing API service. The static build rejects a localhost API URL so it cannot accidentally ship one to phones. Next.js produces a separate HTML page for each route, so a catch-all redirect to the home page is unnecessary.
3. On the API Web Service, set `LUMA_WEB_ORIGIN` to both website origins separated by a comma, for example `https://old-site.onrender.com,https://new-site.onrender.com`. Deploy the latest API code. In Supabase **Authentication → URL Configuration**, add the new website as an allowed redirect and keep the old URL during testing. When the new site is verified, make it the Site URL. If your Google OAuth client lists the website in **Authorized JavaScript origins**, add the new origin there. Keep its existing Supabase callback URL.
4. On a phone, open the new URL in a private tab. Test sign-in, opening a receipt from product history, a full reload on a page like `/budgets/`, and photo upload. Share the new URL after verification. Keep the old website available until everyone has switched.

For a local export check, run this from `frontend` in PowerShell. Set the API URL to the HTTPS address that the static site should call.

~~~powershell
$env:OOPSIE_STATIC_EXPORT = "1"
$env:NEXT_PUBLIC_LUMA_API_URL = "https://your-api.onrender.com"
pnpm build
Remove-Item Env:OOPSIE_STATIC_EXPORT, Env:NEXT_PUBLIC_LUMA_API_URL
~~~

[Render static site deployment](https://render.com/docs/deploy-nextjs-app#deploy-as-a-static-site) · [Render Free Web Services](https://render.com/docs/free#spinning-down-on-idle)

## Publish a small private beta with two Web Services

1. Push this project to a **private GitHub repository**. Review the files about to be committed. Include the app, scanner code and catalog, and SQL migrations. Keep your environment files, local dependencies, receipt photos, and OCR results on your computer.
2. In Render, connect that repo to two Web Services. The API uses the **repository root** because it needs both `backend` and `experiments/receipt-ocr`. The website uses `frontend`.

   | Setting | Website | OCR API |
   | --- | --- | --- |
   | Runtime | Node, set `NODE_VERSION=24` | Python, set `PYTHON_VERSION=3.12.16` |
   | Root Directory | `frontend` | Leave blank |
   | Build Command | `npx --yes pnpm@11.25.0 install --frozen-lockfile && npx --yes pnpm@11.25.0 build` | `python -m pip install -r backend/requirements.txt` |
   | Start Command | `node node_modules/next/dist/bin/next start -H 0.0.0.0` | `python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port $PORT` |

   Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_LUMA_API_URL` on the website. Use the API's Render HTTPS URL for the last value. On the API set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `LUMA_WEB_ORIGIN`, with the website's HTTPS origin for the last value. Redeploy the frontend after changing public environment variables.
3. Apply migrations 001 through 012 in order on a fresh Supabase project. On an existing project, apply any missing migrations in order. Enable the Cron job above when releasing subscriptions. Add the website's HTTPS URL as the Supabase Auth Site URL and an allowed redirect. In Google Cloud add the live website origin to the OAuth client and keep the Supabase callback under Authorized redirect URIs.
4. Set up and verify the few tester accounts first. In Supabase Auth, turn off **Allow new users to sign up** before sharing the link. Existing accounts can still sign in, including your own. Verify that an account outside your tester list cannot create a new account.
5. On the HTTPS URL, test signing in, scanning a receipt, fixing one name, saving, and finding the item on your phone. Verify that a second account sees only its own ledger. Render Free Web Services can go idle, including the frontend and API. For an instant first page, verify a static frontend build and serve it on a CDN. Keep the API active if ledger data also needs to load immediately. Check memory use with real receipt photos.

[Render Next.js guide](https://render.com/docs/deploy-nextjs-app) · [Render FastAPI guide](https://render.com/docs/deploy-fastapi) · [Supabase sign-up settings](https://supabase.com/docs/guides/auth/general-configuration)
