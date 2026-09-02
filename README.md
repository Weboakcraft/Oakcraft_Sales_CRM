# OakCraft Sales CRM

Enquiry → Quotation → Order → Dispatch pipeline for OakCraft. Single-file web app
(`index.html`) + Pro-forma Quotation Builder (`quotation-builder.html`), data in a
Google Sheet through an Apps Script backend, plus an Android app (`android/`).

## Run

* **Web:** host the repo root on any static host (GitHub Pages works) and open `index.html`.
  Everything (Chart.js, SheetJS, jsPDF) is bundled under `lib/`, so it also works offline
  once loaded; the Google Sheet is still the source of truth.
* **Android:** install the APK from the latest GitHub Release (built automatically by
  `.github/workflows/android-apk.yml`) or build it yourself — see [`android/README.md`](android/README.md).
* **Backend:** Apps Script web app URL is set in `index.html` (`CLOUD.url`) and
  `quotation-builder.html` (`GAS_URL`). `apps-script/MetaSheet.gs` mirrors Meta leads to a sheet tab.

## Modules

Dashboard (KPIs, charts, incentive dashboards) · Enquiries / Leads · Pipeline board (drag & drop)
· Meta Leads (sheet view + bulk upload) · Quotations (in-CRM form + PDF builder) · Orders
(multi-product, GST billing, edit quota, WhatsApp update) · Dispatch (courier / tracking / ETA)
· Customers · Products (bulk upload) · Admin Panel (users, permissions, form builder, API settings).

## Roles & permissions

Administrator / Owner see everything. Sales Manager sees all orders. Sales Executive / User
see only their own records. **Permissions saved in Admin Panel → Permissions are enforced**
(view / create / edit / delete per section); defaults come from the role
(Sales Executive: no delete, no add/edit of Customers & Products masters — inline customer
add from an enquiry/order form still works).

## Orders

* **Products are limited to 2 edits.** Re-opening a submitted order lets a user change only
  **item image, quantity and rate** (`productEditCount` on the order); adding/removing a product
  or changing name, type or specification stays blocked, and after the second saved change the
  Products section locks permanently. The separate 7-edit whole-form quota is unchanged.
* **Dispatched orders leave the Orders list.** As soon as an order's status becomes
  `Dispatched` (via the stage button or the order form) a dispatch record is created
  automatically and the order shows only in **Dispatch** — the Orders list keeps
  Confirmed / In Production / Ready / Cancelled. Reports, exports, dashboards and incentives
  still count every order.

* **Product Category** — every product row has a searchable category dropdown right after
  Order Type (27 fixed categories; typing something new offers *Use "…" as a new category*).
  It is required for new products, saved on the order (`items[].category`), shown in the order
  detail table, included in the Orders Excel export (one column after *Product Type*, listing
  each distinct category on the order), and locked together with the rest of the product row
  on an existing order.
* **Permissions apply inside the order too.** *Edit Order*, *Status* and *Advance to …* are
  hidden in the order detail for anyone without Orders → edit, and `advanceOrder` refuses the
  stage change as well; *Close* and *WhatsApp Update* stay available so the order can still be
  read.

## Mandatory fields — nothing incomplete gets saved

Every form now refuses to submit while a required field is empty. What counts as
required is exactly what is already marked in **Admin Panel → Form Builder** (or the `*`
on the form) — no field was made mandatory or optional by this change.

* **Enquiry, Order, Customer, Product** forms read their required list straight from the
  Form Builder, so changing a question there changes the rule with no code edit.
* **Dispatch, Quotation, the inline "+ New customer" box, Add/Edit User, the Form
  Builder's own question editor, Change password and Login** validate their own fields.
* **Quotation Builder** requires the representative's name and number, the client company
  name, and a model name, qty and price on every product line.
* On failure the field gets a red border and a "…bharna zaroori hai" line under it, a
  summary bar at the top of the form lists everything missing, and the page scrolls to and
  focuses the first one. The marks disappear as each field is filled.
* **Skipped, on purpose:** read-only and auto-calculated fields (Total Amount, Pending
  Balance, the auto Enquiry Id), fields hidden by the form's own logic (Box Amount when
  there are no boxes, Full Payment before dispatch), and checkboxes. `0` counts as filled,
  so Freight Amount 0 is accepted.
* **New records vs edits:** file/proof questions (Tax Invoice, Proforma, payment proofs)
  are not demanded while an order is being *created* — they do not exist yet — but they are
  required when that order is edited later. Every other required field applies from the start.

### Server side

The Apps Script backend enforces the same list (`_reqMissing` in `Code.gs`, deployed as
version 30), so a record that skips the UI is refused too. It reads the same Form Builder
config, so the two never drift. Two deliberate limits keep existing data safe: a record
that is unchanged, or that was *already* incomplete before this change, still syncs
normally — the server only rejects a **new** incomplete record, or an edit that empties a
field which had a value. Rejected records come back as `rejected:[{id,missing}]` and the
app shows a toast instead of losing the save silently; any internal error in the validator
passes the record through, so sync can never be blocked by the check itself.

## Pagination

Every table shows **20 rows per page** by default with a footer bar: rows-per-page
(20 / 50 / 100 / 200, remembered in `oc_rowsPerPage` and shared by all sections),
`Showing a–b of n`, Previous / Next and `Page x of y`. Tables with 20 rows or fewer show no
pager. Filters and search re-paginate from page 1; nothing about the underlying data,
exports or totals changes.

## Per-user data access

Scope is normally "admin sees everything, everyone else sees their own records", with one
role elevation (`FULL_DATA_ROLES` — Sales Manager sees all Orders). A named user can now be
given a whole section as well, via `FULL_DATA_USERS`, which exists in **both**
`index.html` (what the UI shows) and the Apps Script `Code.gs` (what the server sends) —
both must list the address or the data never reaches that user. Currently:
`{ quotations: ['accounts@oakcraft.in'] }` — Arun Mourya sees every quotation. Other Sales
Managers are unaffected.

## Order status — the Status button

The order detail view has **Status** next to *Edit Order* / *Delete Order*. It opens a picker
with every stage (Confirmed, In Production, Ready, Dispatched, Delivered, Cancelled) and sets
the chosen one directly — no need to click *Advance* through each stage. It follows the rules
already in place:

* visible only to users with **Orders → edit** permission, and only on their own records
  (admins and Sales Managers see all orders as before);
* works on a **locked** order (7/7 edits used) — a status change is not an edit and never
  touches the form or product edit quotas;
* choosing **Cancelled** requires the same remarks as the form (below);
* **Dispatched / Delivered** create the dispatch record and move the order to Dispatch,
  Delivered also marks the dispatch row delivered;
* moving an order **back out of Dispatch** removes the dispatch row that was auto-created for
  it while it was still empty; a row where courier or tracking was filled in is kept.

Both lists and both sidebar badges refresh immediately after the change.

## Cancelling an order

Choosing status **Cancelled** reveals a required *Cancellation Remarks* box right under the
status field; the order cannot be saved until a reason is entered. The reason is stored on
the order (`cancelRemarks`, plus `cancelledBy` / `cancelledAt`), shown in the order detail
view, and pre-filled when the order is reopened. Other statuses save exactly as before.

## Sidebar badges

Each badge counts exactly what its section lists — same scope, same filters — and is
recalculated from the live data on every save, status change, dispatch move, sync and view
change. In particular the Orders badge excludes orders that have moved to Dispatch, and the
Dispatch badge counts every dispatch row (Delivered included), matching the two lists.

## Navigation

The app remembers the open section (`oc_lastView`) and returns to it after a refresh instead
of jumping to the Dashboard; a section the user may not see falls back to the Dashboard as
before. Background sync (every 25 s) now repaints only when the Sheet data really changed.

## Meta Leads — "New Meta Leads Assigned" email

`apps-script/LeadNotify.gs` mails each user one bulk summary of the leads newly assigned to
them whose `lead_status` is `CREATED`, at their registered address, subject
**"New Meta Leads Assigned"**. Setup is one-time, in the Apps Script editor:

1. paste the file next to `Code.gs`,
2. run **`installMetaNotifyTrigger`** once — it marks today's existing leads as already
   notified (so nobody gets a backlog) and installs a 15-minute trigger.

`previewMetaNotify` shows what would go out without sending; `runMetaNotifyNow` sends
immediately; `removeMetaNotifyTrigger` switches it off. Sent leads are logged in the hidden
`Meta_Notify_Log` tab, so nobody is mailed twice — a re-assignment notifies the new owner.

The file is already in the `Web_Sales_CRM` Apps Script project. Step 2 has to be done by the
account owner: Google asks for consent (send mail as you, sheets, triggers) the first time
`installMetaNotifyTrigger` runs, and only the owner can grant it.

## Build / test notes

* `android/build.sh` — no Gradle needed (aapt + javac + d8/dx + apksigner).
* Every `<script>` block is plain ES5/ES2017; check syntax with `node --check` after edits.

## Releasing an update (so users see "Update available")

* **Android:** nothing manual — every push to `main` that touches the web files or `android/`
  builds a release-signed APK and publishes a GitHub Release; the app compares the release's
  `versionCode` with its own (every 4 h / on "check update") and shows the update banner.
  `versionCode` is *minutes since the Unix epoch*, so it always increases — two builds in the
  same hour no longer share a code (they did while it was `yyMMddHH`, which meant the second
  build of an hour was never offered as an update).
* **Web / PWA:** bump `OC_WEB_BUILD` (near the end of `index.html`, format `YYYY.MM.DD.n`) in the
  same commit. Open browser tabs re-read the hosted `index.html` (cache bypassed) every 4 h, on
  tab focus and via the sidebar "check update" link, and show a "Reload & Update" banner when
  the stamp differs.

## Quotations — one builder for everything

`New Quotation` (header button, list button, and the enquiry's "→ Quote") opens
`quotation-builder.html`; the old in-CRM quotation form and the separate "PDF Builder"
button are gone. Each row in the Quotations list has **View · Edit · Delete**:

| Action | Opens | What happens |
|--------|-------|--------------|
| New Quotation | `#new` | fresh quotation, next shared number is reserved on save/download |
| Edit | `#edit=<QUOTE ID>` | the same quotation with all its data; saving updates that record (number never changes, counter never advances) |
| View | `#view=<QUOTE ID>` | read-only, and the quotation's current PDF is rendered on screen |

The full builder state travels inside the record as `qb` (client, rep, items, terms,
freight, GST), so re-opening a quotation gives back exactly the same form. Quotations made
before this change (and old CRM-form ones) still open — their product line, customer, rep
and validity are mapped into the builder.

**Item images.** An uploaded product photo is kept twice: the full picture goes into
`items[].image` (the same field orders use, so the Apps Script backend stores it in Drive and
returns a link — the record stays small), and a ~200 px inline JPEG goes into
`qb.items[].thumb`. The invoice row always draws the inline thumb, so the item picture appears
in the preview **and** in the generated PDF on every device — a Drive link cannot be drawn into
a PDF (cross-origin), which is why the thumb exists. Thumbs are shrunk further if a quotation
has many images, keeping the record far below the 50,000-character Sheet cell limit.

## Quotation PDF — page sequence

`quotation-builder.html` generates: **Our Clients → Achievements & Milestones → Why OakCraft →
Pro Forma Invoice page(s)**. The two presentation pages are built by `clientsHTML()` /
`achievementsHTML()` (data in `CLIENTS`, `SECTORS`, `CERTS`, `MILESTONES`, `ORDER_MEANS`;
client logos in `CLIENT_LOGOS`). The "Your organisation" card and the quotation number on
those pages are filled from the form.
