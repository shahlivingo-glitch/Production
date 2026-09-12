# Almirah Production Tracker

Multi-page production tracking web app for Shah Living's almirah (steel
cupboard) line, covering how a model is cut from raw sheets, how
production orders get created against that config, and how the cutting
stage actually executes and tracks against them.

This is a full rebuild — the app was wiped to a blank slate (all prior
code and Sheet data erased) partway through this project, then rebuilt
page by page from there. Everything below reflects only the current,
post-rebuild state.

## Architecture

- **Backend**: Google Apps Script, deployed as a JSON API only (no HTML
  served from Apps Script). Lives in `google-scripts/src/*.gs`. Data
  store is a single Google Sheet, one tab per data table, defined by
  `TAB_HEADERS` in `SheetService.gs`.
- **Frontend**: plain HTML/CSS/JS, no framework, no build step, no
  bundler. Lives in `frontend/`, one `.html` + `.js` pair per page, all
  sharing `app.js` (API helpers) and `styles.css`. Hosted on Vercel,
  connected directly to this GitHub repo (auto-deploys on push, no
  workflow involved). Talks to the backend via `fetch()` — see
  `apiGet`/`apiPost` in `frontend/app.js`.
- **Deploy pipeline**: `.github/workflows/deploy.yml` runs on pushes that
  touch `google-scripts/**` — pushes code via `clasp` and updates the
  *same* deployment ID so the API URL never changes. Frontend changes
  need no workflow; Vercel's own GitHub integration handles those.
- **Every page requires login; access is per-user, per-menu.** See
  "Authentication & Permissions" below. (This flips a long-standing
  fact about this app — earlier in the build there was deliberately no
  auth at all; that's no longer true as of the login/permissions feature.)

## Live deployment identifiers

- Apps Script Script ID: `1_tN8iCH5OUV9dnezTXuR4fIE0Mn_fnL0aMnwffrCbx_BXfXjEu-bHePT`
  (in `google-scripts/.clasp.json`)
- Apps Script Deployment ID: `AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw`
- Web app URL (baked into `frontend/app.js` as `API_URL`):
  `https://script.google.com/macros/s/AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw/exec`
- GitHub repo: `https://github.com/shahlivingo-glitch/Production`
- Vercel production URL: `https://production-six-ruby.vercel.app`

These survived the full-reset wipe unchanged — only their *contents*
were erased, not the GitHub repo / Apps Script project / Vercel project
themselves.

## Manual deploy commands

`clasp push` alone does **not** update the live web app — it only
updates the underlying script project. Every backend change needs both,
run from `google-scripts/`:

```
npx clasp push --force
npx clasp deploy -i "AKfycbycgBW8zp3sF20h90ZqpxLFGQ-kBO2Z6yKCkjcnnXbXMcr1ZI2HSqa3onKmu-n70n6Qcw" -d "description"
```

The working pattern for every change this whole rebuild: push + deploy,
then verify against the live URL (`Invoke-RestMethod` in PowerShell, or
`WebFetch` handling the 302 redirect to `script.googleusercontent.com`)
*before* committing — catches schema/logic mistakes before they're
pushed to git. When a schema change risks misaligning existing Sheet
data (see gotcha below), verify real rows are still readable correctly
after `runSetup`, not just that the API returns 200.

## Pages

- **`frontend/index.html` — Cutting Configuration.** Per-model setup:
  3 columns (Models / Parts in One Unit / Sheets Used for Cutting).
  A model can have multiple named **Plans**, each with its own sheet
  layout; **Parts in One Unit is shared across all of a model's plans**
  (fill once, not per plan). Single explicit "Save Changes" button —
  edits are local/dirty-tracked until saved, not autosaved. A plan also
  has a **Plan Type** — `per-unit` (default) or `bulk` — see Bulk Unit
  Plan below.
- **`frontend/orders.html` — Production Order Form.** Creates a
  `Orders` row: picks Model + a named Plan + Qty, shows a live Sheets
  Required breakdown per sheet type, persists to the Sheet (backend
  assigns the real sequential PO number at save time; the displayed
  number beforehand is just a preview). Against a bulk plan, Qty becomes
  a multiplier stepper instead of a free-typed number.
- **`frontend/cuttingStage.html` — Cutting Stage.** Operator dashboard
  (Pending POs) → per-PO Cutting Plan screen with three tabs: Cutting
  Plan (editable sheet-by-sheet breakdown, versioned — see below),
  Version History, Extras (ad-hoc logging). Per-sheet "done" checkboxes
  drive the PO's overall cutting status.
- **`frontend/bendingStage.html` — Bending Stage.** Dashboard (POs with
  at least one sheet cut but bending not yet complete) → per-PO
  checklist. Mirrors Cutting Stage's per-sheet checkbox flow but at
  part-output granularity: marking a sheet done in Cutting is what
  *unlocks* that sheet's part-output rows here: no plan editing or
  versioning of its own, it just derives from Cutting's data.
- **`frontend/extraPartInventory.html` — Extra Part Inventory.**
  Read-only table, auto-tallied running stock of extra/surplus parts
  logged from Cutting Stage. Also called the "Leftover Ledger" — it now
  also receives multi-yield overproduction (see Multi-yield below).
- **`frontend/sheetStock.html` — Raw Sheet Stock.** On-hand count of raw
  sheets per size (`W×H×T` only — no grade). Receive / correct stock;
  view recent movements. Deducted automatically at cut time, never at PO
  creation. May go negative (a short PO still gets created, just warns).
- **`frontend/dashboard.html` — Dashboard.** Operational overview,
  visible to every signed-in user regardless of menu grants: pending
  POs/Bending counts, multi-yield decisions still awaiting a choice,
  sheet sizes short on stock, recent activity. Pure read, no actions.
- **`frontend/login.html` — Sign In.** Shows a one-time "Create Admin
  Account" form instead of a login form until `AppUsers` has its first
  row (`bootstrapStatus`'s `hasAdmin`); a normal login form after that.
- **`frontend/users.html` — User Management.** Admin-only (the page
  itself checks `getCurrentUser().role === 'admin'` and shows a notice
  instead if not, in addition to every action being admin-gated
  server-side). Create users, set each one's per-menu View/Edit/None,
  reset a password, delete a non-admin user.

All eight pages link to each other via a shared top nav, built
per-user by `renderTopNav()` in `app.js` — see Authentication below.

## Authentication & Permissions

Every page requires being signed in; beyond that, a non-admin user's
access is **per-menu** (one of the 6 real pages above, not Dashboard or
User Management) at one of three levels: **None**, **View**, or **Edit**.
Admins bypass all of this — full view+edit everywhere, plus User
Management.

- **Backend** (`google-scripts/src/Auth.gs`): passwords are
  `SHA-256(password + random per-user salt)` — Apps Script has no
  bcrypt/scrypt, this is the pragmatic option for a small internal tool,
  not bank-grade. Login issues a session **token** stored in a new
  `AppSessions` tab (`token → userId`, 30-day expiry); there's no
  practical way to use real cookies across the three origins involved
  (Vercel frontend, `script.google.com`, the
  `script.googleusercontent.com` redirect the API responds through), so
  the frontend just sends the token as a plain parameter on every
  request — same shape as any other param (`?token=...` on GET,
  `{token: ...}` in the POST body).
- **`Code.gs`'s `checkAccess(token, action)`** runs before every single
  action. 3 actions are fully public (`bootstrapStatus`, `login`,
  `createInitialAdmin` — you can't have a token before any of these
  succeed) plus `runSetup` (schema-only, no data exposed, and it has to
  work before `AppUsers` even exists). Everything else needs a valid
  session; most actions additionally belong to one of the 6 menus via
  the `ACTION_MENUS` table and need `'view'` (reads) or `'edit'`
  (writes) on that specific menu. A handful of cross-page reference
  reads (`cuttingConfigModels`, `cuttingConfigPlans`, `cuttingConfigPlan`,
  `sheetStock`, `dashboardSummary`, user-management actions, etc.) are
  deliberately left off `ACTION_MENUS` — they only require *being signed
  in*, not a specific menu's grant, because other pages' own workflows
  depend on them (e.g. the PO form's model dropdown and stock-shortage
  check don't need Cutting Configuration or Raw Sheet Stock access).
  User-management actions enforce admin-only *themselves*
  (`requireAdmin` inside each `Auth.gs` function), as defense in depth
  on top of `checkAccess`.
- **Frontend** (`frontend/app.js`): `requireAuth()` — every page except
  `login.html` calls this first; redirects to login if there's no
  session or the backend says it's no longer valid, otherwise refreshes
  the cached permissions (they may have changed since last login).
  `renderTopNav(activeKey)` rebuilds the nav from `NAV_PAGES` filtered by
  `canView(menuKey)`, plus User Management if admin, plus a
  username+Logout control — this *replaced* the old static per-page
  `<nav>` HTML entirely. `canView`/`canEdit(menuKey)` read the cached
  user's permissions (admins are handed a synthetic all-`'edit'` map by
  `userRowToObject` so nothing needs a separate "or is admin" branch).
- **View-only UI gating is a disclosed, intentionally partial layer —
  the backend is the actual security boundary.** Every page's *primary*
  mutating entry points (Save/Create/mark-done/Add-model/Add-plan/etc.)
  check `canEdit()` and hide or disable themselves; this was verified
  entry-point-by-entry-point per page (grep every `apiPost(` call site),
  not just the obvious "Save" button — e.g. Cutting Configuration's
  per-part "×" remove button calls the API immediately, bypassing Save
  Changes entirely, and needed its own guard. What is **not**
  individually gated: nested local-only edits that only ever reach the
  server through an already-gated Save action (e.g. Cutting
  Configuration's sheet/output editor, Cutting Stage's plan editor —
  add/remove sheet/output, qty/multi-yield edits — are pure
  `configState`/`workingSheets` mutations until "Save Changes" /
  "Save as New Plan Version", both of which are gated). If a future
  entry point is ever added to an editable page, it must get its own
  `canEdit()` check — don't assume gating the visible top-level button
  is automatically enough; re-derive it from the actual `apiPost(` call
  sites the way this pass did.
- **Gotcha hit while building this**: a tab literally named `Users`
  already existed in the spreadsheet from **before this project's full
  reset** — a different, unrelated login system from the pre-rebuild
  app. `setupSpreadsheet()` only rewrites header row *labels*, never
  touches existing data rows (gotcha #2), so naming the new tab `Users`
  would have silently relabeled that old tab's stale leftover row under
  the new columns instead of starting fresh — caught live via a phantom
  `"Admin"` / role `"[]"` row dated from before this rebuild even began.
  Fixed by naming the new tabs `AppUsers` / `AppSessions` instead. If a
  `bootstrapStatus` check or similar ever again reports unexpected
  existing state on a *brand-new* feature's first run, suspect a
  pre-existing tab name collision before assuming the write logic is
  wrong — same category of bug as the CuttingPlans header-collision
  gotcha from the Bulk Unit Plan build, just triggered by a leftover
  tab instead of a schema change.

## Styling

Single shared `frontend/styles.css` (CSS custom properties for
color/spacing/radius/motion tokens, Fira Sans + Fira Code from Google
Fonts, tabular-nums on numeric columns). Generated with the
`ui-ux-pro-max` skill's `--design-system` search treating this as an
internal dense manufacturing dashboard (not a marketing site) —
Minimalism & Swiss Style, navy/blue palette. Animations are plain CSS
(fade/rise entrance with a light nth-child stagger, modal/tab fade-in
via the existing display:none↔block toggles — no JS timing code needed
for either), always wrapped in `prefers-reduced-motion` guards. No
animation library added; stays framework-free like the rest of the app.

## Data model (current, as of `SheetService.gs`)

- `Models`: ModelName, PartsPerUnit (JSON `{partName: qtyPerUnit}` —
  **shared across every plan under that model**), UpdatedAt.
- `CuttingPlans`: ModelName, PlanName, Sheets (JSON array of
  `{width, height, thickness, outputs: [{partName, qty, multiYield?,
  yieldPerSheet?}]}` — one physical sheet per unit *unless* an output is
  `multiYield` — see Multi-yield below; a plan's sheet **count** = sheets
  needed per unit), UpdatedAt, PlanType (`'per-unit'` default | `'bulk'`),
  BaseQty (0 for per-unit; for bulk, every output's `qty` above means "per
  `BaseQty` units", not per 1 — see Bulk Unit Plan below). A model always
  has at least one plan ("Plan 1", auto-created with the model).
- `Orders`: PoNumber (`PO-0001`, sequential, backend-assigned —
  `generatePoNumber()` scans existing rows for the max, no separate
  counter), ModelName, PlanName (the *named* plan picked at order
  creation — not a version), Qty, DxfRefNo, ColourPlan (plain string,
  no structure), DeliveryDeadline, PartyName, PlanVersionId (empty
  until a version is explicitly saved for this PO — see Versioning),
  SheetCompletion (JSON array of booleans, indexed to whichever
  version/plan is currently active), BendingCompletion (JSON array of
  booleans, one per *output row* across all sheets in flattened order —
  see `flattenPlanOutputs` in `Utils.gs` — not one per sheet), 
  TotalSheetsRequired (snapshotted at creation, **informational only**
  now — real per-size need comes from `computeOrderStockNeed`),
  CuttingStatus (`pending`/`complete`, **derived** from SheetCompletion),
  BendingStatus (same, derived from BendingCompletion), CreatedAt,
  MultiYieldDecisions (JSON, see Multi-yield below), SheetStockConsumed
  (JSON `{ "<sheetIndex>": true }` — set once a sheet-type is marked done
  and its stock deduction + ledger posting have run; guards re-checks;
  **not** reversed on uncheck). Both completion arrays plus
  MultiYieldDecisions and SheetStockConsumed are positionally tied to the
  *active plan version's* sheets and reset together whenever that version
  changes. PlanType, BulkBaseQty, BulkMultiplier: snapshotted from the
  plan **at creation** — see Bulk Unit Plan below; `Qty` always means the
  real total unit count either way. SheetQtyOverrides (JSON
  `{ "<sheetIndex>": physicalSheets }` — see Sheet Qty Overrides below).
  BendingLeftoverConsumed (JSON `{ "<entryIndex>": true }` — guards
  against double-consuming the Leftover Ledger on a bending entry's
  repeat/bulk completion, mirroring SheetStockConsumed; see Leftover
  Ledger Checks below).
- `PlanVersions`: VersionId, ModelName, VersionNumber (per-model
  counter, 1-based), SourcePlanName, Sheets (same shape as
  CuttingPlans.Sheets), CreatedAt, Note. Only ever created by an
  explicit user action — see Versioning.
- `CuttingExtras`: ExtraId, PoNumber, Type (`extra-sheet` |
  `extra-part`), Details (JSON, shape varies by Type — see Extras),
  Timestamp.
- `ExtraPartInventory`: ModelName (or the literal string `Universal`),
  PartName, Size, Qty (running total — added to by `addToExtraPartInventory`,
  subtracted from by `consumeExtraPartInventory`, floored at 0, never
  overwritten directly), UpdatedAt. Auto-maintained from `CuttingExtras`,
  from multi-yield "extra full sheet" surplus, and from Bending
  auto-consuming it — see Leftover Ledger Checks below — not directly
  edited by a user anywhere in the UI.
- `SheetStock`: Size (`"<w>x<h>x<t>"` canonical key from
  `sheetSizeKey()`), Width, Height, Thickness, Qty (running on-hand, MAY
  go negative), UpdatedAt.
- `SheetStockLog`: LogId, Size, Delta (+recv / −consume), Reason
  (`received` | `po-cut` | `extra-sheet-cut` | `adjustment`), PoNumber,
  Timestamp, Note. Append-only.
- `AppUsers`: UserId, Username, PasswordHash, PasswordSalt, Role
  (`admin` | `user`), Permissions (JSON `{menuKey: 'none'|'view'|'edit'}`,
  one of Auth.gs's `MENU_KEYS` per key; irrelevant for admins, who get
  everything), CreatedAt, CreatedBy. **Not** named `Users` — see
  Authentication above for why.
- `AppSessions`: Token, UserId, CreatedAt, ExpiresAt (30 days from
  login). One row per signed-in browser; deleted on logout.

### Multi-yield (`MultiYield.gs`, mirrored client-side in `app.js` as
`computeSheetPlanClient` — keep the two in sync)

**Shared-sheet model.** One physical cut of a sheet yields *every* output
row's per-sheet amount at once. A plain row's per-sheet amount is its
per-unit `qty` (the classic "1 sheet = 1 unit's worth"); a `multiYield`
row's is `yieldPerSheet`. So for a PO of N units, per output row:
`need = N × qty`, `perSheetYield = multiYield ? yieldPerSheet : qty`,
`floorSheets = floor(need / perSheetYield)`, `remainder = need %
perSheetYield`.

A sheet-type is cut **`baseSheets` = max(`floorSheets`) across its rows**
times — the hungriest row drives it (the "binding" row). Every other row
overproduces; `surplus = physicalSheets × perSheetYield − need` posts to
the Leftover Ledger at cut time (`applyCutStockAndLedger`, for *all* rows
with surplus, not just multi-yield ones). Plain rows never have a
remainder (`need = N·qty`, `yield = qty` ⇒ divides exactly), so the
binding row with a remainder is always a multi-yield row — **and only
that one row, per sheet-type, gets a decision** (`Orders.MultiYieldDecisions`,
keyed `"<sheetIndex>:<outputIndex>"` of the binding row):
- `extra-sheet` → `physicalSheets = baseSheets + 1` (everything
  overproduces a bit more)
- `scrap` → `physicalSheets = baseSheets`, operator cuts the `remainder`
  short pieces via the existing Extra Sheet Cut
- `pending` (default) → non-blocking at PO creation, badged on the
  Cutting dashboard, resolved from the PO's Cutting Plan tab
  (`setMultiYieldDecision`, which also recomputes `TotalSheetsRequired`).

Worked example (the case that drove this design): sheet = `Side ×2` +
`Top ×1 multiYield 4`, PO for 10. Side: need 20, 2/sheet → 10 sheets
(binds, no remainder). Top: need 10, 4/sheet → rides along, 10×4 = 40
produced, **30 surplus Top → Leftover Ledger**. No decision prompt.

Stock deducts in `applyCutStockAndLedger` (from `setSheetComplete` /
`markAllSheetsComplete`), best-effort — a stock/ledger error never
blocks the completion checkbox.

### Sheet Qty Overrides

`Orders.SheetQtyOverrides` (JSON `{ "<sheetIndex>": physicalSheets }`)
replaces the calculated `physicalSheets` for that sheet-type wherever an
entry exists, for **every** downstream consumer of the sheet math — it's a
4th param on both `computeOrderSheetPlan` (MultiYield.gs) and
`computeSheetPlanClient` (app.js): `computeOrderSheetPlan(sheets, poQty,
decisionsMap, physicalOverrides)`. Applied *after* the natural
base/decision math, right before the per-row `produced`/`surplus`/
`shortOnScrap` numbers are derived — so every one of those stays
consistent with whichever number wins. `sanitizeSheetQtyOverrides(raw,
sheetCount)` drops out-of-range indices and non-numeric/negative values
before anything reaches the math or gets stored. A sheet-plan entry's
`overridden` flag (true when that sheet-index has an override) drives the
"actual" vs. calculated wording in the UI.

One field, refined twice over an order's life:
1. **PO creation** — the "Sheets Required" section's per-sheet qty is
   editable (pre-filled with the calculated default); `createOrder` sanitizes
   `payload.sheetQtyOverrides` and stores whatever the user actually touched.
2. **Cutting Stage mark-done** — checking a sheet's "done" box first asks
   "Sheets actually cut" (pre-filled with the sheet's current — possibly
   already-overridden — planned qty, editable) *before* the existing
   extra-parts question; `setSheetComplete`'s `payload.actualSheetsCut`
   overwrites that sheet's entry, since it's the most authoritative number
   available at cut time. This is what actually drives stock deduction and
   Leftover Ledger surplus in `applyCutStockAndLedger` — not the calculated
   figure.

`markAllSheetsComplete` (bulk "mark all complete") does **not** collect a
per-sheet actual-cut value — it applies whatever's already in
`SheetQtyOverrides` (creation-time overrides, or nothing) unchanged.

### Leftover Ledger Checks

Both Cutting Stage and Bending Stage look up the Leftover Ledger
(`ExtraPartInventory`) for a part before/while it's worked on, but react
differently — Cutting only informs, Bending acts:

- **Cutting Stage (informational only)**: `getOrderDetailBundle` returns
  `leftoverByPart` (`{ partName: qty }`, via
  `getLeftoverByPartForSheets(modelName, sheets)` in `CuttingExtras.gs`) —
  every non-extra part referenced anywhere in the order's active sheets that
  currently has ledger stock > 0. The Cutting Plan tab shows a quiet note
  under any output row whose part is in that map ("N pcs already available
  in leftover stock"). Pure read, computed fresh on every page load — never
  changes `computeOrderSheetPlan`'s math, never consumes anything.
- **Bending Stage (acts on it)**: `getBendingQueueForOrder` attaches
  `leftoverAvailable` to each not-yet-done, non-extra entry (0 once done).
  The UI shows an actionable banner ("pull and use those first") instead of
  a quiet note. Marking that entry done consumes
  `min(entry.qty, leftoverAvailable)` from the ledger via
  `consumeExtraPartInventory` (floors at 0, never goes negative) — so
  leftover stock used for this task isn't still sitting there to be offered
  to a future order.

Both directions key off **non-extra rows only** — extras never auto-post
to or draw from the ledger either way (matches `applyCutStockAndLedger`'s
own `!r.isExtra` scoping), and the lookup is always
`(order.modelName, partName, size: '')` — a plain part's ledger key, same
one `applyCutStockAndLedger` posts surplus to.

Bending's consumption only fires on a genuine not-done → done *transition*
in the current call (`consumeBendingLeftoverIfNew`'s `wasDone` check),
**not** just "whenever `BendingLeftoverConsumed` lacks an entry" — this
matters specifically for `markAllBendingComplete`, which (like
`markAllSheetsComplete`) unconditionally touches every eligible entry on
every call. Without the transition check, the *first* bulk-complete click
after this feature shipped would retroactively consume ledger stock for
entries that were already bent long ago, for reasons that have nothing to
do with today's click. `setBendingComplete` (single-entry) additionally
guards on `BendingLeftoverConsumed` itself, mirroring `SheetStockConsumed`,
so an uncheck→recheck of the same entry can't double-consume either.

### Bulk Unit Plan

A plan's `PlanType` can be `'bulk'` with a `BaseQty` (e.g. 10): its
`Sheets` outputs are then totals for `BaseQty` units, not 1. A PO against
it moves in whole multiples via a **multiplier** stepper on the PO form
(no free-typed qty for bulk) — `Qty = multiplier × BaseQty`, snapshotted
onto the order as `PlanType`/`BulkBaseQty`/`BulkMultiplier` at creation
so a later plan edit never changes how an *existing* PO's sheets compute.

**The whole feature rides on one insight**: `computeOrderSheetPlan` /
`computeSheetPlanClient` only ever take a generic multiplier "N" and
compute `need = N × row.qty` — they don't know or care whether N means
"units" (per-unit plan) or "batches of BaseQty" (bulk plan). So bulk
plans reuse the *entire* multi-yield/remainder/decision/stock-need engine
verbatim; the only real work was making sure every call site feeds the
**right N**. `Orders.gs`'s `getOrderSheetMultiplier(row)` is the single
source of truth for that N (`bulk ? BulkMultiplier : Qty`) — every
backend spot that computes sheet math from an existing order
(`applyCutStockAndLedger`, `setMultiYieldDecision`'s rebuild path,
`saveNewPlanVersion`/`setActivePlanVersionForOrder` in `PlanVersions.gs`)
must go through it, never read `row.Qty` directly for that purpose.
`getCurrentOrderSheetMultiplier()` is the client-side mirror
(`cuttingStage.js`). Missing this in `PlanVersions.gs` was an actual bug
caught during verification: saving a new plan version on a bulk PO was
recomputing `MultiYieldDecisions` against raw `Qty` (e.g. 20) instead of
the multiplier (2), which would silently demand 10× too many sheets.

`Bending.gs` needs no multiplier awareness at all — completion is
per-(sheet,output) booleans regardless of qty or multiplier, per the
Multi-yield section above.

Cutting Configuration's qty-deduction column (gotcha #3 below) is
similarly generalized: `getRemainingQty` targets `part.total × (bulk ?
BaseQty : 1)`, so per-unit plans are byte-identical (multiplier 1) and a
bulk plan's "remaining" is correctly scaled to a full batch.

**Gotcha hit while building this**: after adding `PlanType`/`BaseQty` to
`TAB_HEADERS.CuttingPlans`, an early `runSetup` call landed during the
post-deploy propagation window (see gotcha #11) and ran against
not-yet-updated code, writing only the *old* 4-column header row. Because
`rowsToObjects` reads headers from the **physical sheet's row 1**
(`values[0]`), not from `TAB_HEADERS` directly, the two new columns'
blank header cells both mapped to the *same* `''` key and silently
clobbered each other on read — `PlanType` disappeared and `BaseQty`
appeared to have never saved, even though the write itself was correct.
Fixed by re-running `runSetup` once propagation had actually settled.
Lesson: after any `TAB_HEADERS` change, don't trust the *first*
post-deploy `runSetup` — verify the header row content itself (e.g. via
a throwaway raw-row-dump action) if a new field seems to silently vanish,
rather than assuming the write logic is wrong.

## Key design decisions / gotchas

1. **Google Sheets silently coerces numeric-looking text to real
   numbers**, even when written via the API as a JS string (e.g. a
   model or part named `"4002"` becomes the number `4002`, breaking a
   naive `===` lookup). Hit this exact bug live on a real user-typed
   model name. Fix used everywhere: every ID/key lookup and comparison
   goes through `String(a) === String(b)`, never a bare `===`. See
   `findRowById` in `SheetService.gs` — this is the one place it's
   handled centrally; anywhere a lookup is done with a raw
   loop/predicate instead of that helper, it needs the same `String()`
   wrapping (e.g. `deleteRowsWhere` predicates, `listExtraPartInventory`
   accumulation matching).
2. **`setupSpreadsheet()` (`Setup.gs`) only rewrites header row labels**
   — it never touches or realigns existing data rows. If `TAB_HEADERS`
   changes shape (columns added/reordered) after real rows already
   exist, those rows' data silently misaligns under the new headers on
   next read. Hit this multiple times rebuilding this app (`Orders`
   twice, `Models`/`CuttingPlans` once). The fix every time: **before**
   running Setup after a header change, read and save off the affected
   real rows' current correct values via the live API; run Setup; then
   explicitly re-write those rows' fields by name (which correctly
   lands in the new column positions since writes go through the
   *header-name* → column mapping, not raw column index) rather than
   leaving them to silently drift. Never skip this check just because
   the API still returns 200 — misaligned data reads back "successfully"
   with wrong values in the wrong fields.
3. **Cutting Configuration's qty-based deduction**: a part's "remaining"
   qty shown in column 2 is always `total (shared, model-level) ×
   batchMultiplier - assigned (sum of that part's qty across every output
   row in the *currently open plan's* sheets)` — computed fresh on every
   render, never cached/stored. `batchMultiplier` is 1 for a per-unit
   plan (so this is the original per-unit-only formula, unchanged) and
   `BaseQty` for a bulk plan (its sheets target "BaseQty units' worth" of
   each part, not 1 unit's worth — see Bulk Unit Plan above). A part
   disappears from the visible list once remaining reaches 0; reappears
   if an output row referencing it is edited/removed. Editing the
   displayed number directly is interpreted as the new *remaining*
   target in the *current plan's* units, converted back to the
   model-wide per-unit `total` by dividing out `batchMultiplier`
   (`newTotal = (currentAssigned + typedValue) / batchMultiplier`) —
   important not to skip that division on a bulk plan, or a single
   edit there would inflate the shared per-unit BOM ~`BaseQty`-fold.
4. **Removing a part cascades across every plan for that model**, not
   just the one currently open (`removeCuttingConfigPart` on the
   backend) — the browser only holds one plan's sheets in memory at a
   time, so a local-only removal would leave dangling part references
   in a model's *other* plans.
5. **Plan Versioning is the core Cutting Stage guarantee: a version is
   only ever created by the user explicitly clicking "Save as New Plan
   Version."** Nothing else is allowed to write a `PlanVersions` row —
   this was a real bug fixed mid-build (`getActivePlanVersionForOrder`
   used to silently auto-create "version 1" the instant a PO's Cutting
   Plan screen was opened, before any save). Opening a PO with no saved
   version now just *reads* the model's current named plan for
   display/editing (a virtual `versionId: null` snapshot) — no write.
   Once a real version exists, saving again always creates a **new**
   row; the previous version is never deleted or overwritten. Switching
   to an older version via "Use for this PO" just re-points
   `Orders.PlanVersionId` — no new row.
6. **Sheet completion is per-PO, indexed to whichever plan is currently
   active** (`Orders.SheetCompletion`, a boolean array). It resets to
   all-`false` — and `CuttingStatus` resets to `pending` — every time
   the active version changes (new version saved, or an old one
   reactivated), since sheet *indices* from a different plan don't mean
   the same thing. `CuttingStatus` is never set directly by a
   button — it's always `computeCuttingStatus(completion, totalCount)`,
   i.e. `complete` iff every tracked sheet is checked. **Bending mirrors
   this exactly, one level down**: `Orders.BendingCompletion` is indexed
   to the flattened list of *output rows* (part+qty per sheet, not
   per-sheet) from that same active plan version, resets together with
   SheetCompletion for the same reason, and a given entry can only be
   marked done once its *origin sheet's* SheetCompletion entry is true
   (enforced server-side in `setBendingComplete`, not just hidden in the
   UI). `BendingStatus` is `computeBendingStatus(completion, totalCount)`.
7. **`completion[idx] = value` on a short/empty array creates real
   sparse-array holes, and `Array.prototype.every` silently *skips*
   holes instead of treating them as false** — so checking only the
   *first* tracked item could flip a derived status to `complete` after
   1 of 9, purely because the array happened to be short. Found live
   while building Bending (out-of-order completion exposed it
   immediately) and it affected Cutting's identical pattern too, just
   never surfaced there because sheets had only ever been checked in
   ascending order so far. Fixed by never trusting `completion.length`
   or `.every()` — both `computeCuttingStatus`/`computeBendingStatus`
   now walk every index up to the real known total (sheets.length /
   `flattenPlanOutputs(sheets).length`, from the active version) and
   treat any unset index as incomplete. If a third stage ever needs the
   same per-item-checkbox pattern, reuse this shape, not a raw `.every()`
   on the stored array.
8. **Extra parts have three related but distinct concepts, easy to
   conflate**:
   - A **normal** output-row part (from `Models.PartsPerUnit`) — no
     size, always scoped to the PO's own model.
   - A **custom "+ Extra Part"** entry — free-typed Name + Size, usable
     in the Cutting Plan editor's own sheet outputs (`isExtra: true` on
     that output, no inventory link), *or* logged as an ad-hoc
     `CuttingExtras` row (mark-sheet-done prompt / standalone Extras-tab
     form), which *does* feed `ExtraPartInventory`.
   - **Model tagging on a logged extra part**: specific model (any
     configured model, not necessarily the PO's own) or `Universal`
     (`UNIVERSAL_MODEL_TAG` in `CuttingExtras.gs`) — determines which
     `ExtraPartInventory` row it accumulates into.
   - Matching/accumulation rule: same (model-or-universal, name, size)
     exactly → same inventory row, qty adds. Any difference in name or
     size → a new row. This is enforced by `addToExtraPartInventory`'s
     exact match on all three fields — no fuzzy matching.
   - Typing a custom part's name gets **typeahead suggestions** (native
     `<datalist>`, `frontend/cuttingStage.js`) from every distinct name
     logged before, auto-filling that name's most-recently-used size
     (only into an empty Size field — never clobbers a size the user
     already typed). Backend: `listKnownExtraParts()` in
     `CuttingExtras.gs`, one entry per name (case-insensitive), not per
     name+size pair.
9. **CORS**: the frontend is on a different origin than the Apps Script
   API, so requests must stay "simple" to avoid a preflight OPTIONS
   request Apps Script doesn't handle. POSTs use
   `Content-Type: text/plain` with a JSON string body (parsed
   server-side via `JSON.parse(e.postData.contents)`); GETs use plain
   query-string params. Don't change `apiPost`/`apiGet` in `app.js` to
   send `application/json` — it will break in the browser.
10. **Appending a column to a tab that already has data is safe;
   reordering is not.** `rowsToObjects` maps by header *name*, and a
   missing trailing cell reads as `undefined` (→ `parseJsonSafe(…, {})`).
   `MultiYieldDecisions` / `SheetStockConsumed` / `SheetQtyOverrides` were
   added to the *end* of `TAB_HEADERS.Orders` for exactly this reason — no
   capture/repair dance. Gotcha #2's dance is only for mid-array
   inserts/reorders. **But this only works after `runSetup` actually runs
   again** — `rowsToObjects` builds each row object's keys from the
   *live sheet's own row 1*, not from `TAB_HEADERS`, so adding a name to
   `TAB_HEADERS` alone does nothing for reads until `setupSpreadsheet()`
   re-writes row 1 to include it (`appendRow`/`writeRowUpdates` use
   `TAB_HEADERS` directly for column *position*, so a write into the new
   column silently succeeds even before that — it's just unreadable until
   the header catches up, which looks exactly like "the value didn't
   save"). Hit live when `SheetQtyOverrides` was added: `createOrder`
   correctly computed and stored it, but `getOrder` echoed back `{}` until
   `GET ?action=runSetup` was called once against the live deployment.
11. **`SheetService.gs` per-execution read cache** (`_sheetRowCache`):
   `getAllRows` reads each tab once per request; writes
   (`appendRow`/`writeRowUpdates`/`deleteRowsWhere`) invalidate that
   tab. Fixed 30 s+ page loads from an N+1 read pattern. Fresh per web
   request, so never stale across requests.
12. **Apps Script's real remaining cost is round trips, not per-tab reads**:
   after the read-cache fix, a single action is ~3-5s regardless of how
   many tabs it touches (the redirect-through-googleusercontent.com dance
   and cold dispatch dominate) - so a screen making N *sequential* calls
   costs N × that floor. Cutting Stage's `openOrder()` used to be 3 waves
   (9-15s+) just to open one PO; `getOrderDetailBundle` in `Code.gs` now
   does the same 7 sub-calls in one execution (~4s total), and
   `saveNewPlanVersion`/`setActivePlanVersionForOrder` (`PlanVersions.gs`)
   return `{version, order}` together instead of making the frontend
   re-`GET order` right after. **Reused, standalone options considered
   and explicitly declined**: replacing Apps Script with a real backend
   (Node.js on Vercel talking to the Sheets API directly, ~200-800ms) was
   designed and locally logic-tested in full but never shipped - the user
   didn't want the Google Cloud service-account setup it requires. If
   revisited, that design is the one to reach for; otherwise, keep
   applying this same "bundle sequential round trips into one action"
   pattern anywhere else multiple dependent calls stack up.
13. **PowerShell tool caveat** (session-specific, not app-specific):
   variables set in one `PowerShell` tool call do not persist to the
   next call — only cwd does. Inline literal values or do multi-step
   work in one combined command block. Also: printing a deeply nested
   API response through `ConvertTo-Json` without a high enough `-Depth`
   silently flattens nested arrays into a space-joined string — looks
   like data corruption but isn't; re-check with a higher `-Depth`
   before concluding there's a real bug.

## Known follow-ups / open items

- Login/auth exists now (see "Authentication & Permissions" above) but
  is per-*menu*, not per-*record* — a user with 'edit' on Production
  Order Form can act on any PO, there's no "only your own POs" concept
  or per-model/per-customer restriction. Every action still trusts
  whatever `poNumber`/`modelName` etc. it's given *once past the menu
  check*.
- No self-service password reset or "forgot password" — only an admin
  can reset another user's password (User Management), and there's no
  email/notification system to support a real reset flow anyway.
- Part Thickness / multi-size sheet variants: not implemented in this
  rebuild at all (a pre-reset version of this app had a "Part Thickness
  Tag" concept; it was not recreated).
- Cancel/delete for `Orders` and `PlanVersions` rows: no delete action
  exists for either — only Models/Plans (Cutting Configuration side)
  support delete. An abandoned or mistaken PO currently has to be
  cleaned up by hand in the Sheet.
- `ExtraPartInventory` has no consumption/deduction flow — it only ever
  accumulates (from logged extras + multi-yield surplus). Nothing draws
  it back down (using stocked extra parts against a new order isn't
  wired up).
- Raw-sheet stock (`SheetStock`) deducts at cut time and can go
  negative; it is **not** reversed if a sheet is un-checked (matches the
  extras prompt). Mistaken deductions are fixed via the Correction form
  on the Raw Sheet Stock page. `applyCutStockAndLedger` is best-effort —
  a failure there is swallowed so completion still records; there's no
  retry/repair if a stock write silently fails.
- Multi-yield decisions and stock deduction are keyed to the active
  plan's sheet indices and reset on any version change — an in-progress
  cut that changes version re-cuts (and re-deducts) from scratch, same
  as SheetCompletion already did.
- "Extra Sheet Cut" deducts 1 from `SheetStock` for whatever W×H×T the
  operator types (0×0×0 if left blank → a junk stock row). No validation
  that the size matches a real stocked size.
- Bending has no extras-logging equivalent (no "extra bent part" concept
  was asked for) and no plan editing of its own — it's a pure derived
  view over Cutting's data. If a future stage (Assembly, Fitting, ...)
  needs the same "unlocked by the previous stage" pattern, Bending.gs's
  shape (flatten the source array once, gate completion on the prior
  stage's completion array, derive status the same walked-index way) is
  the template to copy, not Cutting's original per-sheet code.
