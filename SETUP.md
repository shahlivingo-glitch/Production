# Almirah Production Tracker — Setup

This project's source lives here and deploys to Google Apps Script two ways:
manually via `clasp push` from your machine, or automatically via GitHub
Actions whenever you push to `main`. Everything below is a one-time setup.

## 1. Install dependencies

From this folder:

```
npm install
```

This installs `clasp` (Google's Apps Script CLI) locally.

## 2. Enable the Apps Script API

Go to https://script.google.com/home/usersettings and turn the toggle **ON**.
Without this, `clasp` cannot talk to your account at all.

## 3. Log in with clasp

```
npx clasp login
```

This opens a browser window — sign in with the Google account that will own
the spreadsheet (your normal Google account is fine). After you approve, it
creates a file at `~/.clasprc.json` on your machine. **Never commit this
file** — it contains your personal auth tokens. `.gitignore` already excludes
it.

## 4. Create the Google Sheet + bound script

1. Go to sheets.google.com → create a **Blank spreadsheet**.
2. Rename it "Almirah Production Tracker".
3. `Extensions → Apps Script`. This opens a new, empty script project that's
   bound to this sheet (this is what lets `SpreadsheetApp.getActiveSpreadsheet()`
   in the code find the right sheet automatically — no ID to configure).
4. In the Apps Script editor: gear icon (**Project Settings**) → copy the
   **Script ID**.
5. Back in this folder, open `.clasp.json` and replace
   `PASTE_YOUR_SCRIPT_ID_HERE` with that Script ID.

## 5. Push the code and build the tabs

```
npx clasp push
```

This uploads every file in `src/` to the script project (confirm overwrite
if asked). Then:

```
npx clasp open
```

opens the project in the browser. In the file dropdown pick `Setup.gs`, then
click the function dropdown near Run, choose `setupSpreadsheet`, and click
**Run**. First run asks you to authorize — click **Advanced → Go to
(project name) (unsafe)**; this warning is normal for your own scripts.
This creates every tab with correct headers.

## 6. Add your first admin user

Open the `Users` tab in the spreadsheet and add one row:

| UserID | Name | PIN | Role | Stages | Active | CreatedAt |
|---|---|---|---|---|---|---|
| u1 | Your Name | 1234 | admin | ["all"] | TRUE | (any value) |

`Stages` must be typed as literal JSON text: `["all"]`, quotes included.

## 7. Create the first manual deployment

Still in the Apps Script editor: **Deploy → New deployment → type: Web app**.
- Execute as: **Me**
- Who has access: **Anyone**

Click **Deploy**, copy the **Web app URL** (that's the app link for
tablets/phones) and also the **Deployment ID** shown on that screen — you'll
need it in step 9.

Open the URL and confirm you can tap your name, enter the PIN, and see a
dashboard shell.

## 8. Create the GitHub repo

On github.com, create a new **empty** repository (no README/license), then
in this folder:

```
git init
git add -A
git commit -m "Initial almirah production tracker scaffold"
git branch -M main
git remote add origin <your-repo-url>
git push -u origin main
```

## 9. Add GitHub Actions secrets

In the GitHub repo: **Settings → Secrets and variables → Actions → New
repository secret**, add two:

- `CLASP_CREDENTIALS` — paste the **entire contents** of your local
  `~/.clasprc.json` file (the one created in step 3).
- `DEPLOYMENT_ID` — the Deployment ID you copied in step 7.

## 10. Confirm auto-deploy works

Make any small change under `src/`, then:

```
git add -A
git commit -m "test auto deploy"
git push
```

Check the **Actions** tab on GitHub — the "Deploy to Apps Script" workflow
should run and finish green. Refresh the web app URL from step 7 to see the
change live. The URL never changes between deploys, since the workflow
updates that same Deployment ID rather than creating a new one.

## Notes

- PINs are stored in plain text in the `Users` tab, matching the "shop-floor
  PIN pad" login you chose — this is fine for an internal tool on trusted
  tablets, but don't reuse these PINs anywhere sensitive.
- `CLASP_CREDENTIALS` is a personal OAuth refresh token for whichever Google
  account ran `clasp login` — treat that GitHub secret as sensitive as a
  password, and rotate it (re-run `clasp login`, update the secret) if you
  ever suspect it leaked.
