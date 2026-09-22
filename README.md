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

Dashboard (KPIs, charts, incentive dashboards) · Enquiries · Qualified (System Master /
Quotation Sent / Won / Lost) · Pipeline board (drag & drop) · IndiaMART (sheet view + bulk upload)
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
  Products section locks permanently.
* **The whole form can be edited 7 times.** `editCount` now really increments on each saved
  edit (it never did: the old check looked for `#o-items` being gone, but `closeModal()` only
  hides the modal, so the counter stayed at 0 and no order ever locked). A save blocked by
  validation does not count. At 7/7 the order shows a *Locked* chip, *Edit Order* disappears
  and the form refuses to open; the **Status** button, stage advance, WhatsApp and admin
  delete still work. Counting starts from now — no existing order is locked retroactively.
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

## Qualified — every qualified lead in one place

**Enquiries / Leads** is now just **Enquiries**, and a **Qualified** section sits right under it.
Any lead from **Enquiries, IndiaMART or Meta Leads** whose status becomes `Qualified` shows up
there automatically — it stays visible in its own section as well, nothing is moved away or
hidden.

The section has the four subsections the sales flow needs, and each one is simply a status:

| Subsection | Enquiry stage | IndiaMART / Meta `lead_status` |
|---|---|---|
| System Master | `System Master` | `SYSTEM_MASTER` |
| Quotation Sent | `Quoted` | `QUOTATION_SENT` (legacy `PROPOSAL` counts here too) |
| Won | `Won` | `WON` |
| Lost | `Lost` | `LOST` |

Changing a lead's status to one of those four moves it into that subsection and into its count,
straight away, wherever the change is made (the lead's own section or the Qualified list). The
status dropdown inside Qualified writes through the section's existing code — `ocMoveEnq` /
`ML.setStatus` / `IM.setStatus` — so the mandatory remark, the permissions, the owner check and
the audit history all behave exactly as before. A fifth card, *Qualified (pending)*, holds leads
that are qualified but have not moved on yet.

`System Master` is a new enquiry stage (between *Qualified* and *Quoted*); it is added to the
stage dropdowns, the stage filter and the pipeline board. `Quoted` and `Quotation Sent` are the
same step — an enquiry keeps writing `Quoted` (the quotation flow depends on it) and the
Qualified section labels it *Quotation Sent*. A lead is listed under *Won* / *Lost* only if it
really passed through `Qualified` (`qualifiedAt` is stamped the first time it is seen qualified),
so a deal that went straight from *New* to *Lost* never appears here.

## IndiaMART

IndiaMART enquiries get their own section, built like Meta Leads: a sheet-style table
(`query_time · buyer · mobile · city/state · product · status · assigned to`), search, status and
owner filters, inline status and assignment, per-status KPI cards, Excel export, a one-click
**→ Enq** that creates a CRM enquiry, and **Bulk Upload** for an IndiaMART export — drop the
`.xlsx` / `.csv` in or paste the rows; the column names are matched automatically (Sender Name,
Sender Mobile, Product, Assigned Salesperson, Status …) and duplicate mobiles / e-mails are
skipped. Leads can also be added by hand.

Data lives in the `indiamartLeads` collection, which the Apps Script backend creates as its own
tab in the backend sheet the first time a lead is pushed — nothing has to be prepared there by
hand. Permissions (`indiamart`) and the sidebar badge work like every other section, and the
same per-user scoping applies: a Sales Executive sees only the leads assigned to them.

## IndiaMART — sheet se apne aap leads (auto sync)

`apps-script/IndiaMartAutoSync.gs` IndiaMART waali Google Sheet ke **`Indiamart_crm`** tab se
har enquiry CRM ke IndiaMART section (`indiamartLeads`) me le aata hai — bilkul waise hi jaise
`MetaAutoSync.gs` Meta leads laata hai. Assigned Salesperson ka naam CRM ke users roster se
match karke lead usi ke naam par assign ho jaati hai.

* **Column header ke naam se** field map hoti hai, position se nahi — column aage-peeche hon ya
  beech me naya column jud jaaye, kuch nahi bigadta (`Enquiry Id`, `Enquiry Time`, `Buyer Name`,
  `Company Name`, `Mobile Number`, `Email`, `Product / Requirement`, `Quantity`,
  `City/ Location`, `Subject`, `Assigned Salesperson`, `Lead's Quality`, `Qualification Status`,
  `Discussion` — aur inke aam-fehm doosre naam).
* **Mobile:** `+91-9176016345` -> `9176016345`. Country code / dash / space hat jaate hain; 10 ank
  ka number jaisa hai waisa; jo samajh na aaye (landline, ek cell me do number) wo waisa hi rehta
  hai — kuch gum nahi hota. Yahi safai CRM ke andar bhi lagti hai, isliye purane record bhi saaf
  dikhte hain.
* **`send_to_crm` nishaan:** enquiry CRM me pahunchte hi source row ke **column L** me
  `send_to_crm` likh diya jaata hai, aur aisi row dobara kabhi import nahi hoti. Jo enquiry CRM me
  pehle se thi par sheet par unmarked reh gayi thi, uspar bhi nishaan apne aap lag jaata hai.
* **Column L ka pehra:** agar column L par koi asli data column ka header mila (jaise
  *Assigned Salesperson*), to script wahan **kuch nahi likhta** aur Logs me saaf bata deta hai —
  aapka data kabhi overwrite nahi hota. Aise me `IMS_MARK_COL` badal kar koi khaali column de
  dijiye, ya header row me `CRM Status` naam ka column bana dijiye (script khud use pehchan
  leta hai). Cell me pehle se kuch aur likha ho to wo bhi chhua nahi jaata.
* **Duplicate ke chaar pehre:** (1) row par `send_to_crm`, (2) wahi `Enquiry Id` CRM me pehle se,
  (3) wahi mobile **+** wahi enquiry time pehle se (sirf mobile match ho aur time alag ho to wo
  nayi enquiry maani jaati hai — ek hi customer dobara enquiry kar sakta hai), (4) ek hi run ki
  aapas ki duplicate rows.
* **Status:** sheet ka *Qualification Status* saaf-saaf `Qualified` kahe to lead CRM me bhi
  `QUALIFIED` jaati hai (aur Qualified section me dikh jaati hai); baaki sab `CREATED` se shuru
  hoti hain. Sheet ka apna quality / qualification / subject / qty text note me chala jaata hai,
  kuch chhutta nahi.
* Ek run me zyada se zyada `IMS_MAX_PER_RUN` (400) enquiry jaati hain, trigger har
  `IMS_MINUTES` (5) minute chalta hai — purana backlog thode-thode karke apne aap chadh jaata hai.
  Jaldi chahiye to **`backfillIndiaMartAll`** chala dijiye: ye 4.5 minute tak lagataar batch
  chalata hai (Apps Script ka 6 minute ka limit dekh kar khud ruk jaata hai) aur bata deta hai
  kitna baaki hai. `send_to_crm` ka nishaan ab ek-ek cell ki jagah **batch** me likha jaata hai,
  isliye run kai guna tez hai.
* **Nishaan tabhi lagta hai jab lead sach me CRM me pahunch jaaye:** likhne ke baad collection
  dobara padha jaata hai aur sirf unhi rows par `send_to_crm` lagta hai jinki id mil gayi. Ek bhi
  na pahunche to koi nishaan nahi aur log me saaf error — leads agli baar dobara koshish karengi.
  Galti se lag chuke nishaan `clearIndiaMartMarks()` se hat jaate hain (jo lead sach me CRM me
  hai, uska nishaan chhua nahi jaata).

* **Kisi salesperson ka data CRM me na bhejna ho** to uska naam `IMS_SKIP_ASSIGNED` me likh
  dijiye (abhi: `Anjali Sharma`). Aisi row na import hoti hai aur na hi uspar `send_to_crm` ka
  nishaan lagta hai — naam list se hatate hi wo leads normal tareeke se aane lagengi. Jo leads
  pehle hi CRM me aa chuki hain, unke liye CRM ke andar bhi wahi list hai (`HIDE_ASSIGNED`,
  IndiaMART module me): aisi leads list, KPI, badge, export aur Qualified section — kahin nahi
  dikhtin. **Record delete nahi hota**, backend sheet me jaisa hai waisa rehta hai; naam hatate
  hi wapas dikhne lagta hai.

**Ek baar ka setup** (Apps Script editor, `Code.gs` ke saath): file paste kijiye ->
`previewIndiaMartAutoSync` (kuch likhta nahi, sirf Logs) -> theek lage to `installIndiaMartAutoSync`
ek baar. Baaki helpers: `runIndiaMartAutoSyncNow`, `statusIndiaMartAutoSync`,
`markIndiaMartSyncedInSource` (purani rows par nishaan), `removeIndiaMartAutoSync`.

## `bad_collection` — backend ko naye collection ka naam batana padta hai

CRM ka web app har request par collection ka naam apni ek list se milata hai. Us list me
`indiamartLeads` nahi tha, isliye app ko `{"error":"bad_collection"}` milta tha aur IndiaMART
section khaali dikhta tha — jabki sheet ke `indiamartLeads` tab me data maujood hai (Apps Script
andar se seedha `_upsertMany()` bulata hai, jahan ye check lagta hi nahi).

`apps-script/CodeGs_AddIndiaMartCollection.gs` yahi theek karta hai: load hote hi backend ki wahi
list dhoondh kar usme `indiamartLeads` jod deta hai — list ka naam kuch bhi ho, kyunki naam se
nahi **content** se pehchanta hai (jis **array** me `enquiries` aur `orders` dono hon, wahi
allowed-list hai). Kisi maujooda naam ko na hataata hai na badalta hai, aur do baar chal jaye to
bhi naam ek hi baar judta hai. Is CRM me wo list `COLLECTIONS` naam ki hai.

`PREFERRED` / `FORM_OF` / `REQ_FORM_OF` jaise **config objects** ko patch jaan-boojh kar nahi
chhuta — wo allowed-list nahi, har collection ka apna setting hai (column order, form ka naam …),
aur `bad_collection` ka check unse hota bhi nahi. Naam wahan na hone par backend apna default le
leta hai, jo bilkul theek hai. `checkIndiaMartCollection()` unhe sirf report karta hai.

* **Lagana:** poora code **Code.gs ke sabse neeche** paste kar dijiye (sabse pakka), ya alag file
  ki tarah (tab wo Code.gs ke baad load honi chahiye).
* **Jaanch:** `checkIndiaMartCollection()` — log batata hai list mili ya nahi, naam juda ya nahi,
  aur seedha API se `list` ka jawab bhi dikhata hai.
* **Zaroori:** iske baad *Deploy → Manage deployments → edit (pencil) → Version: New version →
  Deploy*. URL wahi rehta hai; naye version ke bina web app purana code hi chalata rahega.
* List agar kisi function ke andar chhupi ho to patch imaandari se bata deta hai — us soorat me
  Code.gs me `bad_collection` search karke aas-paas waali list me naam haath se jod dijiye.

`apps-script/CrmBackendProbe.gs` (sirf jaanch, kuch likhta nahi) backend ka poora naksha dikhata
hai: kaun se function maujood hain, har collection me kitni rows hain, sheet ke tabs, aur
`list` / `getAll` ka asli jawab.

## Jo collection `getAll` nahi bhejta, CRM khud maang leta hai

`CLOUD.pull()` sirf `?action=getAll` maarta hai aur backend apni jaani-pehchani collections hi
bhejta hai — `indiamartLeads` uski list me nahi hai. Isliye IndiaMART leads backend sheet me likhi
to ja rahi thin (source row par `send_to_crm` bhi lag raha tha) par CRM ka section khaali dikhta
tha. Ab (build `2026.09.22.5`) CRM khud sambhaal leta hai, **Code.gs ko chhue bina**:

1. `getAll` ke jawab par nazar rakhi jaati hai — kaun si collection aayi, kaun si nahi.
2. Jo `CLOUD.keys` me hai par jawab me nahi aayi, use seedha `action:'list'` se maanga jaata hai
   (yahi API app pehle se `users` ke liye istemal karta hai).
3. Aayi hui rows local ke saath **merge** hoti hain — jis row ka local timestamp naya hai wo local
   hi rehti hai, isliye abhi-abhi badla hua status kabhi peeche nahi jaata.
4. Jis din backend `getAll` me ye collection bhejne lagega, ye extra call apne aap band ho jayegi.

Privacy wahi rehti hai: jo user poora data nahi dekh sakta, uske device par sirf uske apne (owner)
records hi rakhe jaate hain — wahi rule jo `scope()` UI me lagata hai. Console helpers:
`ocPullCollection('indiamartLeads')` aur `ocServedKeys()`.

## Lead kis-kis ko assign ho sakti hai

Har IndiaMART lead Ankush Goswami ke naam par chadh rahi thi (558 me se 558,
"Unassigned 0") — jabki wo Administrator hain, sales me hain hi nahi. Do jagah
ek hi kism ki galti thi:

`ims_ownerFor_()` (Apps Script) aur `emailOfName()` (app) sheet me likhe naam ko
CRM user se **character prefix** se milaate the:

```js
if(keys[i].indexOf(nm) === 0 || nm.indexOf(keys[i]) === 0) return roster.byName[keys[i]];
```

Isse sheet ka koi bhi aadha-adhoora naam ("A", "An") kisi bhi user ke naam ka
prefix ban jaata tha, aur loop **pehla** match lauta deta tha. Users list me
sabse upar Ankush Goswami hain — isliye saari aisi leads unke paas chali gayin.
Wahi bug pehle `ims_skipAssigned_()` me tha (ek-akshar ka naam "Anjali Sharma"
se mil jaata tha).

Ab milaan **poore shabd** par hota hai aur **do aadmi par shaq ho to kisi ko
nahi chunte** — lead unassigned rehti hai. `"Niti"` → Niti Kumari chalega,
`"Kumari"` (Niti Kumari + Pinki Kumari dono) → unassigned, `"An"` → unassigned.
Galat aadmi ko de dena unassigned chhodne se kahin zyada nuksaan karta hai.

Uske upar, lead sirf unhe di ja sakti hai **jo sach me leads uthate hain**:

| Kaun chhoot jaata hai | Kyun |
|---|---|
| Administrator, Sales Manager | role leads nahi uthata (`ims_takesLeads_` / `ocIsSalesRole`) |
| status Active nahi | CRM me chalu hi nahi |
| `IMS_NO_LEADS` / `OC_NO_LEADS` me likhe naam | role bhale sales ka ho, ye log leads par kaam nahi karte |

Ye list dono jagah hai — **ek jaisi rakhiye**:

* `apps-script/IndiaMartAutoSync.gs` → `IMS_NO_LEADS` (abhi: Arun Mourya, Pinki Kumari)
* `index.html` → `OC_NO_LEADS` (wahi naam)

Kisi ko wapas laana ho to naam list se hata dijiye, ya Users me uska role
"Sales Executive" kar dijiye — kuch aur badalne ki zarurat nahi.

CRM me "Assigned to" dropdown (IndiaMART aur Meta Leads, dono) ab isi chhoti
list se bharta hai (`leadRoster()` / `window.ocLeadRoster()`). `roster()` abhi
bhi saare users lautaata hai — `nameOf()` ko har user chahiye taaki kisi purane
owner ka naam bhi dikh sake. Jis lead par pehle se koi assign hai wo apni row me
dikhta rehta hai, chahe wo list me na ho — warna admin ke dobara save karte hi
kisi ki purani assignment chupke se badal jaati.

### Pehle se galat assign hui leads sudhaarna

Matcher theek ho gaya, par jo leads pehle hi import ho chuki hain unka owner CRM
me likha hai, sheet me nahi. Apps Script me:

```
previewIndiaMartOwners()   // kuch nahi badalta — sirf batata hai kya badlega
fixIndiaMartOwners()       // asli sudhaar
```

Preview har badlaav ko `purana -> naya  [sheet me likha: "..."]` ki shakal me
ginti ke saath dikhata hai, isliye chalane se pehle saaf pata chal jaata hai ki
sheet me asal me likha kya hai. Jis lead par **kaam shuru ho chuka hai** (status
CREATED se aage) uska owner jaan-boojh kar nahi chheda jaata — ho sakta hai kisi
ne CRM me khud sahi banda assign kiya ho; log me unki ginti alag dikhti hai.

## Fallback se aayi rows wapas sheet par nahi jaatin

v34 (`getAll` ke bahar se collection maangna) rows seedha `localStorage` me
likhta tha, aur v32 ke sync guard ko iski khabar nahi hoti thi. Guard ko wo
rows "local badlaav" lagti thin, to har boot par **poori collection wapas
sheet par** chali jaati thi — 558 rows ka `saveMany`, bina kisi badlaav ke.

Ab v34 merge ke baad `window.ocLeadNoteServerRows(coll, rows)` bulata hai, jo
un rows ko guard ke snapshot me darj kar deta hai. Sirf wahi rows jo server se
**jaisi ki taisi** li gayin — jinpar local copy nayi thi wo darj nahi hotin,
unka push hona hi chahiye. `seen` list ko haath nahi lagaya jaata: `getAll` in
rows ko bhejta hi nahi, aur `seen` me daal dene par agla merge inhe "sheet se
delete ho gayi" maan kar hata deta.

## Meta Leads — the status no longer resets itself

Users reported that a status set in Meta Leads came back as **New / CREATED** a while later.
Three things together caused it, and all three are fixed:

1. **The whole collection was pushed on every save.** `metaLeads` had no row-level guard (orders
   and enquiries got one in v7/v8), so `store.set('metaLeads', …)` sent *every* row to the sheet
   with `saveMany`. Merely opening the section was enough — `renderMetaLeads()` normalises and
   saves on every render. A browser whose copy was a couple of minutes old therefore rewrote all
   the rows and pushed somebody else's fresh status back to `CREATED`.
   *Now:* only rows that really changed are sent, and only rows this user is allowed to write
   (owner / admin). A pure normalisation difference (alias fields like `name` / `phone`) is not
   sent at all, and the debounced full-collection push that was already queued at page load is
   cancelled.
2. **A push was never confirmed.** The old `fetch` was fired and forgotten, so a failed or
   rejected write was silently lost and the next sync overwrote the local copy.
   *Now:* the write goes out over XHR, the row is marked as synced only after the server
   acknowledges it, and anything unconfirmed sits in a pending queue that is retried every two
   minutes, after each pull and when the tab regains focus (`ocLeadPending()` in the console
   shows what is still waiting).
3. **A pull always overwrote local data.** The sheet's copy replaced localStorage even when the
   local record was newer, so a change made seconds earlier disappeared.
   *Now:* a pull merges. A row whose local timestamp is newer than the sheet's (or that is still
   pending) is kept and re-sent; everything else comes from the sheet. A row that is missing from
   the sheet is kept only if it never reached it — a row deleted on the sheet still goes away.

`apps-script/MetaAutoSync.gs` got the matching fix on the sheet side: a source row that already
carries `Sync_Done_CRM` in column H is never imported again (the row-number pointer could slip
after rows were inserted, deleted or the script property was lost, and the lead came back as a
brand-new `CREATED` record), and a name + mobile pair that already exists in the CRM is skipped
as well. `SYSTEM_MASTER` and `QUOTATION_SENT` map to the new stages. Re-paste that file in the
Apps Script editor to pick the change up; no trigger or pointer has to be touched.

The same guard covers `indiamartLeads`.

**The CRM also defends itself if that Apps Script file is not re-pasted.** After every sync it
looks for two Meta rows with the *same mobile* (last 10 digits) **and** the *same*
`created_time_ist` — that is what a re-import looks like; two genuine enquiries never share the
same second. The row that was worked on (status past `CREATED`, or any update on it) stays; the
untouched copy is marked `dupOf: <kept id>` and disappears from the Meta list, the counts, the
badge and the export. The mark travels to the sheet, so every device hides the same row, and the
sheet row itself is **never deleted** — nothing is destroyed, only hidden. If *both* copies have
been worked on, nothing is hidden and a warning is logged instead, because hiding either one
would lose somebody's work. Admin helpers in the browser console: `ocMetaDupReport()` lists what
is hidden, `ocMetaUnhideDup('<id>')` brings a row back.

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

## GP — every quotation, PI and order says whether it makes money

A quotation or order now shows its own gross profit while it is being written, from
the cost the [Sales GP Calculator](https://github.com/Weboakcraft/sales_gp_calcularot)
already holds. Nothing is typed twice and nothing is written back to that sheet.

**Where it shows.** `quotation-builder.html` gets a **GP · Fayda ya Ghata** panel under
the form (and a colour chip in the top bar, so the verdict is visible without
scrolling); the Orders form gets the same panel under Products, and the order detail
view gets a GP block. None of it is printed, none of it reaches the PDF, and the
client never sees it.

**What it computes.** `lib/gp-engine.js` is a verbatim copy of the calculator's own
engine, so the two never disagree:

```
net sales value = (list price − discount) × qty  + freight billed to the customer
BOM cost        = armrest + seat mechanism + base + wheels          (per piece × qty)
gross profit    = net sales value − BOM cost                        GST stays out of it
```

Per line it shows cost/pc, net rate/pc, GP/pc and GP%; per order the sale value, BOM
cost, gross profit, GP per piece, GST and invoice value, plus the approval level from
`M_ApprovalMatrix` and the price rise needed to reach the target GP. A line priced
below its own cost turns red.

**Where cost comes from.** The GP calculator's Google Sheet — `M_Products` for each
model's standard four parts, `M_Components` for their rates. The model is matched from
the product name typed on the line (exact, then a contains match, then whatever the
user picked last time for that name). A line that matches nothing can be pointed at a
model by hand, or given the four costs directly; both choices are saved on the record
(`qb.items[].gpModel` / `gpCost`, `items[].gpModel` / `gpCost` on orders) and remembered
for the next quotation with that name. Masters are cached in the browser for 6 hours,
so GP still works offline.

**Connecting it (once).** Admin Panel → API Integrations → **GP Calculator (cost
master)**: paste the calculator's Apps Script `/exec` URL and its `SHARED_TOKEN`, then
Save API settings — the setting syncs to the Sheet, so every device gets it. A browser
where someone already used the calculator's own **Connect Sheets** dialog needs nothing:
both sites sit on the same origin and the bridge reads those settings too. Until it is
connected, an admin sees a two-field connect box inside the GP panel; nothing else in
the CRM changes.

**Who sees what.** Owner, Administrator and Sales Manager see the full breakdown.
Everyone else sees only the verdict — Fayda / Ghata — with no rupee and no percentage,
because component cost is not a sales-floor number. The two lists are at the top of
`gp-bridge.js` (`GP_FULL_ROLES`, `GP_FULL_USERS`). This is a UI rule, not a secret: the
GP snapshot is stored on the record like any other field, so treat it as "not shown"
rather than "cannot be reached".

**Saved with the record.** Each quotation and order keeps a `gp` snapshot (sale value,
BOM cost, GP, GP%, verdict, per-line cost, and when it was taken) plus `gpPct` and
`gpAmount` at the top level, so a deal can be read back later as it was priced. If the
cost sheet is unreachable at save time the previous snapshot is kept — it is never
overwritten with zero.

**Customer auto-fill.** Typing a client name in the quotation builder now completes from
the CRM's customer master and fills contact person, billing and shipping address, GSTIN
and phone; place of supply follows the GSTIN's state code (or the city). Only empty
fields — and fields the auto-fill itself put there — are touched, so nothing typed by
hand is overwritten.

**Files.** `lib/gp-engine.js` (maths, copied verbatim — re-copy it if the calculator's
engine changes), `gp-bridge.js` (cost master + panel), `gp-quotation.js` and
`gp-order.js` (the glue for each page). After editing any of them bump the `?v=` on the
script tag, and `OC_WEB_BUILD`, as usual.
