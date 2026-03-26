# OptiCapture — Demo Script

A structured walkthrough for live presentations. Follow the order below for a clean, logical flow.

---

## Pre-Demo Checklist

Run these before the audience arrives:

- [ ] `npm run dev:scan` started — both server and tunnel running
- [ ] Browser open at `https://localhost:3000`
- [ ] Phone connected to tunnel URL (verify QR scan works once)
- [ ] Demo accounts seeded (`NODE_ENV` is not `production`)
- [ ] At least one category and a few inventory items exist
- [ ] Logs have some history (import a file or add a few items beforehand)

---

## 1. Login Page

**What to show:**
- Full navy background on mobile / half-screen — clean, professional look
- Split layout on desktop (brand panel left, form right)
- Log in as `admin` / `admin123`

**Talking points:**
> "Secure JWT-based authentication with Google OAuth support built in. Accounts have login lockout after five failed attempts — production-grade security from day one."

---

## 2. Dashboard

**What to show:**
- Stats bar: Total Categories, Total Items, In Stock, Out of Stock
- Category grid with icons — click into a category to see items
- Global search bar — search across all inventory instantly
- Add a new item: fill in name, UPC, set price and quantity, save
- Edit an item inline — update a quantity, save
- Delete an item — show the two-step confirmation
- Pagination toggle: 50 / 100 / 200

**Talking points:**
> "The dashboard gives you a live snapshot of your entire store. Categories keep things organized — each one shows item count and total stock at a glance."

> "Product data is real: scan or type a UPC and the system fetches the product name, brand, and image automatically from Open Food Facts and UPCitemDB."

---

## 3. Barcode Scanning — Mobile

**What to show:**
- Navigate to Scan — session creates immediately, QR code visible
- Show the OTP displayed under the QR code
- Scan the QR code with your phone — mobile scanner opens in the phone browser
- Scan a product barcode on your phone — item appears in the staged list on desktop with name and image auto-filled
- Commit staged items — items move into inventory

**Talking points:**
> "No app install. Staff scan a QR code once and their phone becomes a barcode scanner. The session is OTP-protected and expires automatically after two hours."

> "Product lookup is live — scan a UPC and you get the product name, brand, and image instantly. No manual data entry."

---

## 4. Barcode Scanning — Hardware Scanner

**What to show:**
- Switch to "Attach Scanner" tab — green pulsing indicator, status shows "Listening for scans"
- Plug in a USB barcode scanner (or simulate: type digits quickly + Enter)
- Item appears in staged list — same auto-lookup as mobile

**Talking points:**
> "USB and Bluetooth scanners work out of the box — no drivers, no pairing, no configuration. The system detects scanner input by timing: a scanner fires a full barcode in under 80ms, which is how we distinguish it from someone typing at a keyboard."

---

## 5. Bulk Import

**What to show:**
- Upload a prepared Excel file (multi-sheet: each sheet = one category)
- Show the column auto-detection and preview
- Confirm import — items appear in dashboard

**Talking points:**
> "Existing inventory in Excel or CSV? Drop it in. The importer auto-detects column headers — no rigid template. Multi-sheet Excel files create one category per sheet automatically."

---

## 6. Activity Logs

**What to show:**
- Every action just performed appears in the log
- Filter by action type (CREATE, UPDATE, DELETE, IMPORT)
- Filter by date range using the date pickers
- Search by username or detail text

**Talking points:**
> "Every action is logged — who did what, when. That's your audit trail for compliance, accountability, and debugging. Filter by date, action type, or keyword."

---

## 7. Store Settings

**What to show:**
- Store name, address, logo — all editable by owner
- Log out, log back in as `taker` / `taker123`
- Navigate to Store Settings — fields are read-only, view-only banner shown
- Password change section still available for all roles

**Talking points:**
> "Role-based access is enforced at every level. A Taker can see store information but can't change it — that's an Owner action. Every role sees exactly what they need, nothing more."

---

## 8. SuperAdmin Panel

**Access:** Navigate to `/admin`, log in as `superadmin` / `superadmin123`

**What to show:**
- Stats: total stores, active, suspended, total items across platform
- Filter stores by status (Active / Suspended), search by name or email, sort by joined date
- Edit a store's details
- Reset a user's password — modal shows temp password with copy button
- Suspend / activate a store

**Talking points:**
> "The SuperAdmin panel is the control plane for the entire platform. One view across all tenants — manage stores, users, and access from a single interface."

---

## Closing Talking Points

- **No dedicated hardware** — any phone, any USB/Bluetooth scanner, any browser
- **Real-time** — scans appear on the desktop the moment they're committed
- **Production-ready security** — rate limiting, lockout, httpOnly cookies, MIME validation, Helmet headers
- **Multi-tenant from day one** — every record is store-scoped; adding a new store is one row in the database
- **CI on every push** — GitHub Actions runs type-check and build automatically
- **Built to scale** — SQLite today, Postgres tomorrow via a single adapter swap

---

## Things to Avoid During Demo

- Do not show the browser console — expected development warnings may appear
- Do not scan with cellular if tunnel is not running — use WiFi or start `npm run dev:scan` first
- Do not demo Google OAuth unless `GOOGLE_CLIENT_ID` is configured in `.env`
