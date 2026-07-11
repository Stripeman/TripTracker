# Deploying Trip Tracker to Azure

This guide gets your Trip Tracker online so you (and people you invite) can use it from anywhere, with your data saved in the cloud. **It's written for non-experts — just follow the steps in order.** Everything here uses the Azure website (the "Portal"), so there's nothing to install.

**Cost:** about **$0–$1 a month**. The website hosting is free; you only pay a few cents for data storage.

**Time:** ~20 minutes the first time.

---

## What you'll set up (the big picture)

You'll create three things and connect them:

1. **A GitHub copy of the app** — where the code lives.
2. **A Static Web App** — the website itself (free, includes the behind-the-scenes "API").
3. **A Storage account** — a safe place to keep your trips data file.

Then you'll **invite yourself** so you can see and edit the data, and (optionally) turn on **email for access requests**.

> Don't worry about what these words mean — the steps tell you exactly what to click.

---

## Before you start

- A **GitHub account** (free — github.com) with this app's code in a repository. If a developer set this up for you, you already have this.
- An **Azure account** (free — portal.azure.com). A new account includes free credit.

---

## Step 1 — Create the Storage account (your data's home)

1. Go to **portal.azure.com** and sign in.
2. In the top search bar, type **Storage accounts** and click it.
3. Click **+ Create**.
4. Fill in:
   - **Resource group:** click **Create new**, name it `trip-tracker`, click OK.
   - **Storage account name:** a lowercase, no-spaces name that's unique, e.g. `triptrackerdata123`. Remember it.
   - **Region:** pick one near you.
   - **Redundancy:** choose **Locally-redundant storage (LRS)** (cheapest).
5. Click **Review + create**, then **Create**. Wait ~1 minute for it to finish, then click **Go to resource**.
6. **Get the connection string** (you'll paste it in Step 3):
   - In the left menu, scroll to **Security + networking** → click **Access keys**.
   - Click **Show** next to **key1's Connection string**, then the **copy** icon.
   - Paste it somewhere temporary (a sticky note / Notepad). You'll need it shortly.

---

## Step 2 — Create the website (Static Web App)

1. In the Azure search bar, type **Static Web Apps** and click it.
2. Click **+ Create**.
3. Fill in:
   - **Resource group:** choose the `trip-tracker` group you made in Step 1.
   - **Name:** anything, e.g. `trip-tracker`.
   - **Plan type:** **Free**.
   - **Region:** pick one near you.
   - **Source:** **GitHub**. Click **Sign in with GitHub** and authorize.
   - Pick your **Organization**, **Repository** (the app's repo), and **Branch** (usually `main`).
4. Under **Build Details**, set these **exactly**:
   - **Build Presets:** **Custom**
   - **App location:** `/`
   - **Api location:** `api`
   - **Output location:** *(leave blank)*
5. Click **Review + create**, then **Create**.
6. Azure now builds your site automatically. Click **Go to resource**, and after a couple of minutes you'll see a **URL** at the top — that's your live site. (If it's not ready yet, wait and refresh.)

> **What just happened:** Azure added a small file to your GitHub repo that rebuilds the site every time the code changes. You don't have to touch it.

---

## Step 3 — Connect the storage (so saving works)

1. In the Azure Portal, open your **Static Web App** (from Step 2).
2. Left menu → **Environment variables** (under *Settings*).
3. Click **+ Add** and enter:
   - **Name:** `AZURE_STORAGE_CONNECTION_STRING`
   - **Value:** the connection string you copied in Step 1.
4. Click **Apply** / **Save**.

That's it — no rebuild needed. Your site can now read and save the trips data file.

---

## Step 3.5 — Turn on sign-in (Microsoft, Google & Yahoo)

People log in with whatever account they already have — Microsoft, Google/Gmail, or Yahoo. You set each one up **once**. You do **not** invite anyone in Azure; who gets in is managed inside the app (Step 4).

> **Your real address is `https://www.triptracking.org`** (the `www`). The bare `triptracking.org` just forwards to it, so **always use the `www` address** in redirect URIs — never the apex.

Each provider is the same shape: register an "app" on that provider, copy its **Client ID** + **Client secret**, paste them into your Static Web App's **Environment variables**. You can start with just one (Microsoft is easiest if you have a Microsoft account) and add the others later. The sign-in screen shows a button for each provider you've configured.

### Microsoft (any Microsoft account)
1. Portal → **Microsoft Entra ID** → **App registrations** → **+ New registration**.
   - **Name:** `Trip Tracker`
   - **Supported account types:** **Accounts in any organizational directory and personal Microsoft accounts** (this lets *any* Microsoft account sign in; your access list decides who actually gets in).
   - **Redirect URI:** **Web** → `https://www.triptracking.org/.auth/login/aad/callback`
   - **Register**, then copy the **Application (client) ID**.
2. **Authentication** → **Add URI** → add `https://delightful-dune-0b6ba6d0f.7.azurestaticapps.net/.auth/login/aad/callback` (handy for testing) → **Save**.
3. **Certificates & secrets** → **+ New client secret** → **Add** → copy the **Value** immediately.
4. SWA → **Environment variables** → add `AAD_CLIENT_ID` (the client ID) and `AAD_CLIENT_SECRET` (the value).

> The issuer in `staticwebapp.config.json` is already `https://login.microsoftonline.com/common/v2.0` — that's what accepts any Microsoft account. Nothing to edit there.

### Google
1. **console.cloud.google.com** → create/choose a project → **APIs & Services** → **Credentials** → **+ Create Credentials** → **OAuth client ID**.
2. **Application type:** Web application. **Authorized redirect URI:** `https://www.triptracking.org/.auth/login/google/callback`. **Create**.
3. Copy the **Client ID** and **Client secret**.
4. SWA → **Environment variables** → add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`.

### Yahoo
1. **developer.yahoo.com** → **My Apps** → **Create an App**.
2. Choose **OpenID Connect** / Web Application. **Redirect URI:** `https://www.triptracking.org/.auth/login/yahoo/callback`. Request **email** + **profile** permissions.
3. Copy the **Client ID** and **Client Secret**.
4. SWA → **Environment variables** → add `YAHOO_CLIENT_ID` and `YAHOO_CLIENT_SECRET`.

After saving env vars, a redeploy (a minute or two) picks them up.

### Testing on a staging/preview branch? Add its URL too

If you push to a non-`main` branch and open a **pull request**, Azure automatically
deploys a separate **preview environment** with its own unique URL (e.g.
`https://<your-app>-3.<region>.azurestaticapps.net` — find it under your Static Web
App → **Environments** → the row for that PR → **Browse**). Each sign-in provider only
accepts redirect URIs you've explicitly registered, so signing in on a preview URL
**will fail** ("Error 400: redirect_uri_mismatch" for Google, or an equivalent error for
Microsoft/Yahoo) until you add that preview's callback URL alongside your production
one, in the same places as above:

- **Google:** console.cloud.google.com → **APIs & Services → Credentials** → open your
  OAuth client → **Authorized redirect URIs** → **+ Add URI** →
  `https://<preview-url>/.auth/login/google/callback` → **Save**.
- **Microsoft:** Entra ID → **App registrations** → your app → **Authentication** →
  **Add URI** → `https://<preview-url>/.auth/login/aad/callback` → **Save**.
- **Yahoo:** developer.yahoo.com → your app → add
  `https://<preview-url>/.auth/login/yahoo/callback` as an additional redirect URI.

Each new pull request gets a **different** random URL suffix, so you'll need to repeat
this for each new PR you want to sign in on — reusing the same PR (pushing more commits
to it instead of opening a new one) keeps the same preview URL for your whole testing
session, so you only have to do this once per round of testing.

---

## Step 4 — Give yourself (and others) access — managed inside the app

There are **no Azure invitations**. Access is an **email→role list you edit right in the app**. Make yourself the first admin, then manage everyone from the app.

**A. Make yourself the bootstrap admin (one time).** SWA → **Environment variables** → add `BOOTSTRAP_ADMIN_EMAIL` = the email you'll sign in with (you can list several, comma-separated). This email **always** has admin, so you can never lock yourself out. Save (wait a minute for the redeploy).

**B. Sign in.** Go to `https://www.triptracking.org`, click **Sign in**, pick your provider. You land in with full admin rights.

**C. Manage everyone in the app.** Open **⚙ → System → Access list**. Add a row per person — their **email** + a **role** — and click **Save access list**. They can now sign in (Microsoft, Google, or Yahoo, using that email) and get the role you gave them. Remove a row to revoke access.

| Role | What they can do |
|------|------------------|
| `reader` | View trips only |
| `editor` | View + add / edit / delete trips |
| `admin` | Everything, plus import, clear data, and manage the access list |

> Roles are read **at sign-in**, so a change takes effect the next time that person signs in (have them sign out and back in if already logged in).

**You're done!** The app is live, data saves to the cloud, and only people on your access list can see it — no Azure portal invitations to manage.

---

## Step 5 (optional) — Email for "Request access"

When someone without access visits, they can click **Request access** and enter their email. By default this opens *their* email app. If you want the request **emailed straight to you** instead, do this 5-minute setup using a free service called **Resend**.

**A. Get a Resend key**
1. Go to **resend.com** and sign up (free). Note the email you sign up with — call it **YOUR-EMAIL**.
2. In Resend, click **API Keys** → **Create API Key** → copy the key (starts with `re_`).

**B. Add 3 settings in Azure**
1. Azure Portal → your **Static Web App** → **Environment variables** → **+ Add**.
2. Add these three (one at a time), then **Save**:

   | Name | Value |
   |------|-------|
   | `RESEND_API_KEY` | the `re_…` key you copied |
   | `RESEND_FROM` | `onboarding@resend.dev` |
   | `ACCESS_REQUEST_TO` | **YOUR-EMAIL** (the exact address you used to sign up to Resend) |

**C. Test it**
1. Open your site → **Request access** → type any email → **Send request**.
2. You should see **"Request sent ✓"** and get an email at **YOUR-EMAIL** within a minute.

> ⚠️ **The one catch:** the free `onboarding@resend.dev` sender can **only** email **YOUR-EMAIL**. So `ACCESS_REQUEST_TO` must be that same address. For personal use that's perfect — requests land in your inbox.
>
> **Want requests to go to a different inbox?** In Resend → **Domains**, add your own website domain and follow their steps until it says **Verified**. Then change `RESEND_FROM` to e.g. `Trip Tracker <noreply@yourdomain.com>` and you can set `ACCESS_REQUEST_TO` to any address.

Finally, type the same email into the app at **⚙ → System → Access requests** so it also appears on the sign-in screen as a backup.

> **These same two settings also power family invite emails.** Once `RESEND_API_KEY` and `RESEND_FROM` are set, any family admin can send a real invite email (Family Management → an invite's "Customize & send an actual email…") — unlike access requests, invite emails can go to **any** address, not just `ACCESS_REQUEST_TO` (the invitee, whoever they are). `ACCESS_REQUEST_TO` itself is unused for invites. If `RESEND_FROM` is still the free `onboarding@resend.dev` sender, verify your own domain first (see above) — Resend's free sender can only deliver to your own signup address, which defeats the point of inviting other people.

---

## Step 6 (optional but recommended) — Turn on data backups

Every save replaces the whole data file, so it's smart to let Azure keep old copies you can roll back to.

1. Azure Portal → your **Storage account** → left menu → **Data protection**.
2. Tick these boxes and **Save**:
   - **Enable versioning for blobs**
   - **Enable soft delete for blobs** — set 30 days
   - **Enable soft delete for containers** — set 30 days

Now every save keeps the previous version. To restore one:
- Storage account → **Containers** → `data` → click `trip-tracker.json` → **Versions** tab → pick a time *before* the problem → **…** → **Restore**.

The app also auto-downloads a dated backup before any *Clear data*, and **⚙ → Export** makes a manual backup anytime.

> **"Who's online" needs nothing extra.** The presence feature uses the **same storage account** (a small **Table Storage** table, created automatically on first heartbeat) and the same `AZURE_STORAGE_CONNECTION_STRING` — no new resource, env var, or setup. It just works once the API is deployed.

---

## Troubleshooting

**The site shows "Not connected" / keeps using Browser storage.**
The behind-the-scenes API didn't deploy. This is almost always because the build settings were blank. Check the diagnostic at **⚙ → System** — if it says `HTTP 404 from /api/trips`:
1. In GitHub, open the file `.github/workflows/azure-static-web-apps-*.yml`.
2. Find the section with `app_location`, `api_location`, `output_location` and make sure it reads:
   ```yaml
   app_location: "/"
   api_location: "api"
   output_location: ""
   ```
   (The common mistake is `api_location: ""` — it must be `"api"`.)
3. Save/commit. Azure rebuilds automatically in a couple of minutes. Then reload the site → **⚙ → System → Retry connection**.

**What the diagnostics mean** (shown at ⚙ → System):
- `HTTP 404 from /api/trips` — the API isn't deployed (do the fix above).
- `HTTP 500` — the API is deployed but the storage connection string is missing or wrong (re-check Step 3).
- `Could not reach /api/trips` — you're opening the file directly instead of through the site's web address (normal for Local mode).

**Access-request email isn't arriving.**
- Make sure all three settings from Step 5 are present.
- If you see **"Email service rejected the request" (502)**: you're using the free `onboarding@resend.dev` sender but `ACCESS_REQUEST_TO` isn't your Resend account email. Set it to your Resend signup email, or verify your own domain (see the note in Step 5).

**I signed in but see "No access".**
Your account hasn't been given a role yet, or you changed roles and need to sign out and back in. Do Step 4.

**"Error 400: redirect_uri_mismatch" (or similar) when signing in on a staging/preview URL.**
That preview environment's callback URL isn't registered with the sign-in provider yet — see "Testing on a staging/preview branch?" in Step 3.5 above.

---

## For developers (optional)

Prefer the command line, or want to run it locally? These are conveniences — the Portal steps above are all you need.

**Create storage via CLI:**
```
az group create -n trip-tracker -l eastus
az storage account create -n triptrackerdata -g trip-tracker --sku Standard_LRS
az storage account show-connection-string -n triptrackerdata -g trip-tracker -o tsv
```

**Enable versioning/soft-delete via CLI:**
```
az storage account blob-service-properties update \
  -n triptrackerdata -g trip-tracker \
  --enable-versioning true \
  --enable-delete-retention true --delete-retention-days 30 \
  --enable-container-delete-retention true --container-delete-retention-days 30
```

**Run locally with the [SWA CLI](https://aka.ms/swa-cli)** (emulates the API + auth):
```
npm i -g @azure/static-web-apps-cli
cd api && npm install && cd ..
swa start . --api-location api
```
Without it, a plain local web server works too — the app just stays in Local mode.

**Sign-in internals:** the app offers **Microsoft, Google, and Yahoo** sign-in via custom provider registrations in `staticwebapp.config.json` (`auth.identityProviders`), each wired to `*_CLIENT_ID` / `*_CLIENT_SECRET` app settings. Roles are **not** assigned through Azure portal invitations — `auth.rolesSource` points at `/api/roles`, which looks each signed-in email up in an admin-managed allowlist (`access-list.json` in Blob Storage, edited in ⚙ → System → Access list) plus the `BOOTSTRAP_ADMIN_EMAIL` safety net, and returns `reader`/`editor`/`admin`. Requires the **Standard** plan. The data API is role-gated in the same file (`GET /api/trips` needs `reader`/`editor`; writes need `editor`; `/api/access` needs `admin`). Anonymous visitors aren't blocked from loading the page — the app shows a “no access” message and the API stays locked.

**Environment variables reference:**

| Variable | Required | Purpose |
|----------|----------|---------|
| `AAD_CLIENT_ID` | For Microsoft sign-in | Microsoft Entra app registration's Application (client) ID |
| `AAD_CLIENT_SECRET` | For Microsoft sign-in | Microsoft Entra app registration's client secret value |
| `GOOGLE_CLIENT_ID` | For Google sign-in | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | For Google sign-in | Google OAuth client secret |
| `YAHOO_CLIENT_ID` | For Yahoo sign-in | Yahoo OAuth client ID |
| `YAHOO_CLIENT_SECRET` | For Yahoo sign-in | Yahoo OAuth client secret |
| `BOOTSTRAP_ADMIN_EMAIL` | Recommended | Email(s) that always get admin (comma-separated) — your lock-out safety net |
| `AZURE_STORAGE_CONNECTION_STRING` | Yes | Where trips data is stored |
| `TRIPS_CONTAINER` | No (default `data`) | Storage container name |
| `TRIPS_BLOB` | No (default `trip-tracker.json`) | Data file name |
| `PRESENCE_TABLE` | No (default `presence`) | Table Storage table for "who's online" |
| `RESEND_API_KEY` | For email | Resend API key |
| `RESEND_FROM` | For email | Verified sender address |
| `ACCESS_REQUEST_TO` | For email | Where access requests are sent |
