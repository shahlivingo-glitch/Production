# Almirah Production Tracker

Multi-stage production tracking web app for Shah Living's almirah (steel
cupboard) line: Order Form → Cutting → Bending → Assembling → Powder
Coating → Fitting, plus a shared QC/checker dashboard.

## Architecture

- **Backend**: Google Apps Script, deployed as a JSON API only (no HTML
  served from Apps Script). Lives in `google-scripts/src/*.gs`. Data store
  is a single Google Sheet ("Production Super" in this deployment), one tab
  per data table, defined by `TAB_HEADERS` in `SheetService.gs`.
- **Frontend**: plain HTML/CSS/JS, no framework, no build step. Lives in
  `frontend/`. Hosted on Vercel, connected directly to this GitHub repo
  (auto-deploys on push, no workflow involved). Talks to the backend via
  `fetch()` — see `apiGet`/`apiPost` in `frontend/app.js`.
- **Deploy pipeline**: `.github/workflows/deploy.yml` runs on pushes that
  touch `google-scripts/**` — pushes code via `clasp` and updates the *same*
  deployment ID so the API URL never changes. Frontend changes need no
  workflow; Vercel's own GitHub integration handles those.

## Live deployment identifiers

- Apps Script Script ID: `1_tN8iCH5OUV9dnezTXuR4fIE0Mn_fnL0aMnwffrCbx_BXfXjEu-bHePT`
  (in `google-scripts/.clasp.json`)
- Apps Script Deployment ID: `AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw`
- Web app URL (baked into `frontend/app.js` as `API_URL`):
  `https://script.google.com/macros/s/AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw/exec`
- GitHub repo: `https://github.com/shahlivingo-glitch/Production`
- Vercel production URL: `https://production-six-ruby.vercel.app`

## Manual deploy commands

`clasp push` alone does **not** update the live web app — it only updates
the underlying script project. Every backend change needs both, run from
`google-scripts/`:

```
npx clasp push --force
npx clasp deploy -i "AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw" -d "description"
```

The GitHub Action does this automatically on push, but doing it manually
first (then verifying against the live URL with a `fetch`/curl before
committing) has been the working pattern this whole build — catches
mistakes before they're pushed.

## Data model (current, as of `SheetService.gs`)

- `Orders`: OrderID, ModelNoName, Qty, DXFRefNo, ColourPlan(JSON), DeliveryDeadline, CustomerName, Status, CreatedAt, CreatedBy
- `ModelSettings`: ModelNoName, SheetSequence(JSON array), PartsPerSheet(JSON `{sheetCode: {partName: qtyPerUnit}}`), BOM(JSON `{item: qtyPerUnit}`), CuttingTimeTargets(JSON `{sheetCode: minutes}`), BendingSequence(JSON array of part names), BendingTimeTargets(JSON `{partName: minutesPerPiece}`), AssemblyTimeTarget, FittingTimeTarget, UpdatedAt, UpdatedBy
- `AppSettings`: singleton row — CuttingSetupTime, BendingSetupTime, AssemblySetupTime, FittingSetupTime, UpdatedAt, UpdatedBy (global, same for every model — machine start-up/warm-up/maintenance, not per-model)
- `CuttingLog`: LogID, OrderID, ModelNoName, SheetCode, SheetSequencePos, UnitIndex, Status, StartedAt, CompletedAt, OperatorID, Points — **one row per (sheet, unit)**, not per sheet per order
- `CuttingQC`, `BendingQC`: recount records, `BendingQC` includes PartName (needed since SheetCode alone can't disambiguate multiple parts from one sheet)
- `BendingQueue`: QueueID, OrderID, PartName, SheetCode, Qty, Status, Priority, StartedAt, CompletedAt, OperatorID, Points — Qty accumulates as cutting jobs complete, into whichever row is still `unlocked` for that (OrderID, PartName)
- `AssemblyLog`, `FittingLog`: one row per **unit** (Qty always 1), not per order
- `PowderQueue`, `PowderMainStock`, `PowderPersonalStock`: colour/batch-based, not per-unit — powder coating happens in batches, unlike the other stages
- `QCLog`: shared across all stages, `ItemRef` meaning varies by stage (LogID for cutting, QueueID for bending, OrderID for assembly/fitting, QueueID for powder) — always the precise row being checked, never a name/code that could collide
- `InventoryLive`, `Users`: as named

## Key design decisions / gotchas

1. **Google Sheets silently coerces numeric-looking text to real numbers**,
   even when written via the API as a JS string (e.g. sheet code `"001"`
   becomes the number `1`, losing leading zeros). Never trust a raw cell
   value for anything compared as a string key. The fix used throughout:
   resolve codes from the JSON-stored source of truth by position/index
   (e.g. `canonicalSheetCode()` in `Cutting.gs` reads
   `model.SheetSequence[sheetSequencePos - 1]`) rather than the bare
   `SheetCode` cell.
2. **`setupSpreadsheet()` (Setup.gs) only rewrites header row labels** — it
   never touches or realigns existing data rows. If `TAB_HEADERS` changes
   shape (columns added/removed/reordered) after a row was already saved,
   that row's data silently misaligns under the new headers on next read.
   The only fix is deleting the row and recreating it via the app (not by
   re-running Setup). Frontend code should guard against this
   (`Array.isArray`/`typeof` checks before `.map`/`.slice`/`Object.keys`)
   so a stale row degrades gracefully instead of crashing the screen — see
   `modelToForm()` in `frontend/modelSettings.js`.
3. **Per-unit job architecture**: Cutting, Bending, Assembly, and Fitting
   all operate per physical unit/piece, not per whole order — confirmed
   directly with the user after the original "one job per order" design
   didn't match shop-floor reality (a 100-unit order means cutting 100
   physical sheets of each pattern, not one job covering all 100).
   - Cutting: one timed job per (sheet pattern, unit copy), target is
     per-sheet (`CuttingTimeTargets`).
   - Bending: queue accumulates quantity per part as cutting completes,
     target is per-part (`BendingTimeTargets`) × however much has
     accumulated in that job.
   - Assembly/Fitting: one job per unit, readiness computed from how much
     material has actually passed QC so far (not just been produced).
   - Setup time (machine start/warm-up) is added once per order, to the
     *first* job of each stage only — see `getSetupTime()` in
     `AppSettings.gs` and the `isFirstXForOrder`/`effectiveXTarget` helpers
     in each stage file.
4. **Login is PIN-based, not Google OAuth** — `Users.PIN` is plaintext (fine
   for an internal tool on trusted shop-floor tablets, per user's explicit
   choice). `Role`/`Active` values are normalized case-insensitively
   (`isActiveValue`, `normalizeRole` in `Auth.gs`) since the Users tab is
   hand-typed and typos in case (ADMIN vs admin) are expected. Actual
   dashboard routing is driven by `Users.Stages` (JSON array), not `Role`
   directly — `Role === 'admin'` is a separate bypass that shows everything.
5. **CORS**: the frontend is on a different origin than the Apps Script API,
   so requests must stay "simple" to avoid a preflight OPTIONS request
   Apps Script doesn't handle. POSTs use `Content-Type: text/plain` with a
   JSON string body (parsed server-side via `JSON.parse(e.postData.contents)`);
   GETs use plain query-string params. Don't change `apiPost`/`apiGet` in
   `app.js` to send `application/json` — it will break in the browser.
6. **QC is split across two places**: Cutting and Bending do inline
   operator-as-checker recounts (immediately after marking done, still in
   the operator's own flow). Assembly, Powder, and Fitting's checks happen
   on the separate shared QC dashboard (`qc.js`/`QC.gs`) instead, per spec.

## Known follow-ups / open items

- Powder Coating has no timer/target/points infrastructure at all (by
  original spec — it's batch-based, not per-piece timed). If the user asks
  for setup time or speed scoring there, that's new infrastructure, not a
  small addition.
- The "XYZ TEST ALMIRAH" test model has needed recreation more than once
  after schema changes — if test data looks wrong, check whether it
  predates the current `TAB_HEADERS` shape before debugging logic.
- Bending's default queue order comes from `ModelSettings.BendingSequence`,
  but the checker can always override live via the "Reorder Priority"
  screen (`bending.js`) — manual reorders aren't preserved against future
  auto-added parts, by design (per spec, checker has final say).
