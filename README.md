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

## Build / test notes

* `android/build.sh` — no Gradle needed (aapt + javac + d8/dx + apksigner).
* Every `<script>` block is plain ES5/ES2017; check syntax with `node --check` after edits.

## Releasing an update (so users see "Update available")

* **Android:** nothing manual — every push to `main` that touches the web files or `android/`
  builds a release-signed APK and publishes a GitHub Release; the app compares the release's
  `versionCode` with its own (every 4 h / on "check update") and shows the update banner.
* **Web / PWA:** bump `OC_WEB_BUILD` (near the end of `index.html`, format `YYYY.MM.DD.n`) in the
  same commit. Open browser tabs re-read the hosted `index.html` (cache bypassed) every 4 h, on
  tab focus and via the sidebar "check update" link, and show a "Reload & Update" banner when
  the stamp differs.

## Quotation PDF — page sequence

`quotation-builder.html` generates: **Our Clients → Achievements & Milestones → Why OakCraft →
Pro Forma Invoice page(s)**. The two presentation pages are built by `clientsHTML()` /
`achievementsHTML()` (data in `CLIENTS`, `SECTORS`, `CERTS`, `MILESTONES`, `ORDER_MEANS`;
client logos in `CLIENT_LOGOS`). The "Your organisation" card and the quotation number on
those pages are filled from the form.
