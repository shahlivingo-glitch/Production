# Almirah Production Tracker — Setup

**Architecture:** the live app pages are static files served by **GitHub
Pages** (from `docs/`). They talk to **Google Apps Script**, which is
deployed as a JSON API only (no HTML) backed by the Google Sheet. The
frontend calls that API with `fetch()`.

```
docs/            -> served by GitHub Pages (index.html, styles.css, app.js)
apps-script/src/ -> pushed to Google Apps Script (Code.gs, SheetService.gs, ...)
```

## 1. Install dependencies

From the repo root:

```
npm install
```

## 2. Enable the Apps Script API

Go to https://script.google.com/home/usersettings and turn the toggle **ON**.

## 3. Log in with clasp

```
npx clasp login
```

Opens a browser — sign in with the Google account that will own the
spreadsheet. Creates `~/.clasprc.json` locally. **Never commit this file**
(it's already in `.gitignore`).

## 4. Create the Google Sheet + bound script

1. sheets.google.com → **Blank spreadsheet** → rename to "Almirah Production
   Tracker".
2. `Extensions → Apps Script`. This creates a script bound to the sheet, so
   `SpreadsheetApp.getActiveSpreadsheet()` in the code finds it automatically.
3. Gear icon (**Project Settings**) → copy the **Script ID**.
4. Open `apps-script/.clasp.json` and replace `PASTE_YOUR_SCRIPT_ID_HERE`
   with that Script ID.

## 5. Push the backend and build the tabs

```
npm run push
```

Then `npm run open` to open the project in the browser. Pick `Setup.gs` in
the file dropdown, choose the `setupSpreadsheet` function, click **Run**.
First run asks you to authorize — click **Advanced → Go to (project name)
(unsafe)**, this is expected for your own script. This creates every tab
with headers.

## 6. Add your first admin user

In the `Users` tab, add one row:

| UserID | Name | PIN | Role | Stages | Active | CreatedAt |
|---|---|---|---|---|---|---|
| u1 | Your Name | 1234 | admin | ["all"] | TRUE | (any value) |

`Stages` must be literal JSON text: `["all"]`, quotes included.

## 7. Deploy the Apps Script API

In the Apps Script editor: **Deploy → New deployment → type: Web app**.
- Execute as: **Me**
- Who has access: **Anyone**

Click **Deploy**. Copy:
- the **Web app URL** (looks like `https://script.google.com/macros/s/.../exec`)
- the **Deployment ID** shown on the same screen

## 8. Point the frontend at the API

Open `docs/app.js`, find:

```js
var API_URL = 'PASTE_YOUR_APPS_SCRIPT_WEB_APP_URL_HERE';
```

Replace with the Web app URL from step 7.

## 9. Create the GitHub repo and push

```
git init
git add -A
git commit -m "Initial almirah production tracker scaffold"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## 10. Turn on GitHub Pages

In the GitHub repo: **Settings → Pages**. Under **Build and deployment**,
set **Source: Deploy from a branch**, **Branch: main**, folder **/docs**.
Save. GitHub gives you a URL like `https://<you>.github.io/<repo>/` —
that's the live app link for tablets/phones. It rebuilds automatically
whenever `docs/` changes on `main`.

## 11. Add GitHub Actions secrets (for auto-deploying the backend)

**Settings → Secrets and variables → Actions → New repository secret**:

- `CLASP_CREDENTIALS` — full contents of your local `~/.clasprc.json`.
- `DEPLOYMENT_ID` — the Deployment ID from step 7.

## 12. Confirm everything is wired up

Open the GitHub Pages URL from step 10, tap your name, enter the PIN, and
confirm the dashboard shell loads with your stage cards.

For future changes: edit files under `apps-script/src/` and/or `docs/`,
commit, and push to `main`.
- Changes under `docs/` go live automatically via GitHub Pages.
- Changes under `apps-script/src/` are picked up by the "Deploy to Apps
  Script" GitHub Action, which pushes to the same script and updates the
  same Deployment ID — the API URL never changes.

## Notes

- PINs are stored in plain text in the `Users` tab, matching the shop-floor
  PIN pad you chose — fine for an internal tool on trusted tablets, don't
  reuse these PINs anywhere sensitive.
- `CLASP_CREDENTIALS` is a personal OAuth refresh token — treat it like a
  password. Rotate it (re-run `clasp login`, update the secret) if you ever
  suspect it leaked.
- The Apps Script API is reachable by anyone with the URL (`access: Anyone`)
  since the frontend now calls it cross-origin with no Google login — every
  write action re-validates the user's PIN/role server-side (see `Auth.gs`),
  it doesn't trust the frontend's session alone.
- Cross-origin requests to Apps Script avoid CORS preflight by using
  `Content-Type: text/plain` on POST bodies (parsed as JSON server-side) and
  plain query-string GETs — that's why `app.js`'s `apiPost`/`apiGet` are
  written the way they are; changing them to send `application/json`
  headers will break in the browser.
