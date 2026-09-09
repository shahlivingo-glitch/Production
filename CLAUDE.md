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
- **No login/auth system exists.** Every page and action is open —
  "Cutting Operator" etc. describe who a page is *for*, not an access
  gate. Flagged repeatedly through the build; not implemented because
  it was never explicitly asked for as its own task.

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
  edits are local/dirty-tracked until saved, not autosaved.
- **`frontend/orders.html` — Production Order Form.** Creates a
  `Orders` row: picks Model + a named Plan + Qty, shows a live Sheets
  Required breakdown per sheet type, persists to the Sheet (backend
  assigns the real sequential PO number at save time; the displayed
  number beforehand is just a preview).
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
  logged from Cutting Stage.

All five pages link to each other via a shared top nav.

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
  `{width, height, thickness, outputs: [{partName, qty}]}` — one
  physical sheet per unit; a plan's sheet **count** = sheets needed per
  unit), UpdatedAt. A model always has at least one plan ("Plan 1",
  auto-created with the model).
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
  TotalSheetsRequired (snapshotted at creation), CuttingStatus
  (`pending`/`complete`, **derived** from SheetCompletion), BendingStatus
  (same, derived from BendingCompletion), CreatedAt. Both completion
  arrays are positionally tied to the *active plan version's* sheets and
  reset together whenever that version changes.
- `PlanVersions`: VersionId, ModelName, VersionNumber (per-model
  counter, 1-based), SourcePlanName, Sheets (same shape as
  CuttingPlans.Sheets), CreatedAt, Note. Only ever created by an
  explicit user action — see Versioning.
- `CuttingExtras`: ExtraId, PoNumber, Type (`extra-sheet` |
  `extra-part`), Details (JSON, shape varies by Type — see Extras),
  Timestamp.
- `ExtraPartInventory`: ModelName (or the literal string `Universal`),
  PartName, Size, Qty (running total, accumulates — never overwrites),
  UpdatedAt. Auto-maintained from `CuttingExtras`, not directly edited.

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
   qty shown in column 2 is always `total (shared, model-level) -
   assigned (sum of that part's qty across every output row in the
   *currently open plan's* sheets)` — computed fresh on every render,
   never cached/stored. A part disappears from the visible list once
   remaining reaches 0; reappears if an output row referencing it is
   edited/removed. Editing the displayed number directly is interpreted
   as the new *remaining* target, not a raw overwrite of total
   (`newTotal = currentAssigned + typedValue`).
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
10. **PowerShell tool caveat** (session-specific, not app-specific):
   variables set in one `PowerShell` tool call do not persist to the
   next call — only cwd does. Inline literal values or do multi-step
   work in one combined command block. Also: printing a deeply nested
   API response through `ConvertTo-Json` without a high enough `-Depth`
   silently flattens nested arrays into a space-joined string — looks
   like data corruption but isn't; re-check with a higher `-Depth`
   before concluding there's a real bug.

## Known follow-ups / open items

- No login/auth. If real access control is ever needed, it's a new
  build, not a small addition — every action currently trusts whatever
  `poNumber`/`modelName` etc. it's given.
- Part Thickness / multi-size sheet variants: not implemented in this
  rebuild at all (a pre-reset version of this app had a "Part Thickness
  Tag" concept; it was not recreated).
- Cancel/delete for `Orders` and `PlanVersions` rows: no delete action
  exists for either — only Models/Plans (Cutting Configuration side)
  support delete. An abandoned or mistaken PO currently has to be
  cleaned up by hand in the Sheet.
- `ExtraPartInventory` has no consumption/deduction flow — it only ever
  accumulates from logged extras. Nothing currently draws it back down
  (e.g. using stocked extra parts against a new order isn't wired up).
- Sheet stock / raw material tracking: not implemented in this rebuild
  (a pre-reset version had this; not recreated).
- Bending has no extras-logging equivalent (no "extra bent part" concept
  was asked for) and no plan editing of its own — it's a pure derived
  view over Cutting's data. If a future stage (Assembly, Fitting, ...)
  needs the same "unlocked by the previous stage" pattern, Bending.gs's
  shape (flatten the source array once, gate completion on the prior
  stage's completion array, derive status the same walked-index way) is
  the template to copy, not Cutting's original per-sheet code.
