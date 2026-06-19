# Deploying Trip Tracker to Azure

This hosts the app **and** lets you update the data through the website itself, cheaply.

## Architecture (≈ $0–$1 / month)

- **Azure Static Web Apps (Free plan)** — serves the app, SSL + custom domain, includes a managed Functions API.
- **Azure Functions** (`/api/trips`) — `GET` reads the dataset, `POST` writes it (sign-in required).
- **Azure Blob Storage** — stores the live `trip-tracker.json` (a few cents/month).

The app auto-detects the API: when `/api/trips` responds it runs in **Cloud** mode (and shows cloud controls in ⚙ → Settings); otherwise it falls back to browser storage / the bundled `trip-tracker.json`, so it still works locally with no backend.

## Files in this repo that matter

```
index.html               → redirects the site root to the app
Trip Tracker.dc.html     → the app
support.js               → runtime
trip-tracker.json        → bundled demo data (fallback / first-run)
staticwebapp.config.json → routes + Entra auth (GET & write both require sign-in; writes require the `editor` role; needs the Standard plan)
api/                      → the Functions API
  host.json
  package.json
  trips/function.json
  trips/index.js
```

## One-time setup

1. **Storage account** (cheapest: StorageV2, LRS):
   ```
   az group create -n trip-tracker -l eastus
   az storage account create -n triptrackerdata -g trip-tracker --sku Standard_LRS
   az storage account show-connection-string -n triptrackerdata -g trip-tracker -o tsv
   ```
   Copy that connection string.

2. **Deploy the Static Web App** — easiest via the Azure Portal → *Create Static Web App* → connect this GitHub repo. Set:
   - **App location**: `/`
   - **Api location**: `api`
   - **Output location**: *(blank)*
   (A GitHub Action is added to your repo and deploys on every push.)

3. **Add the storage connection string** to the Static Web App:
   Portal → your Static Web App → **Environment variables** (or **Configuration**) → add
   `AZURE_STORAGE_CONNECTION_STRING` = *(the value from step 1)*.
   Optional: `TRIPS_CONTAINER` (default `data`), `TRIPS_BLOB` (default `trip-tracker.json`).

4. **Microsoft Entra sign-in (Standard plan required).** Both reading and writing require a signed-in user; writing also requires the **`editor`** role.
   a. **Upgrade the Static Web App to Standard** (Portal → Static Web App → *Hosting plan* → Standard) — custom Entra auth is not available on Free.
   b. **Register an Entra app:** Azure Portal → *Microsoft Entra ID* → **App registrations** → **New registration**. Redirect URI (Web): `https://<your-swa-host>/.auth/login/aad/callback`. Note the **Application (client) ID** and **Directory (tenant) ID**.
   c. **Client secret:** that app registration → *Certificates & secrets* → **New client secret** → copy the **Value**.
   d. **Add app settings** to the Static Web App (Environment variables): `AAD_CLIENT_ID` = client ID, `AAD_CLIENT_SECRET` = secret value.
   e. **Set your tenant** in `staticwebapp.config.json`: replace `<TENANT_ID>` in the `openIdIssuer` URL with your Directory (tenant) ID, then commit.
   The app's **Sign in** link points to `/.auth/login/aad`.

5. **Grant editing rights (roles).** `authenticated` lets anyone who signs in *read*; the `editor` role is required to *save*.
   - Azure Portal → your Static Web App → **Role management** → **Invite** → enter the user, assign role **`editor`** → send the invite link and have them accept.
   - To also restrict *reading* to specific people, change the GET route's `allowedRoles` from `authenticated` to `editor` (or a `viewer` role you invite).

## How data flows once deployed

- The **entire site requires sign-in** (`/*` route is gated). A signed-out visitor is redirected straight to the Entra login and sees nothing — not the page, not the bundled `trip-tracker.json`.
- **Sign in** with an Entra account to view. Saving requires the **`editor`** role; an editor's change `POST`s the full dataset, creating/updating the blob.
- Non-editors who sign in can view; only `editor` accounts can save. To also restrict *viewing* to specific people, change the GET and `/*` routes' `allowedRoles` from `authenticated` to `editor`.

## Local development

Run with the [SWA CLI](https://aka.ms/swa-cli) to emulate the API + auth locally:
```
npm i -g @azure/static-web-apps-cli
cd api && npm install && cd ..
swa start . --api-location api
```
Without it, plain Live Server works too — the app just stays in local mode.
