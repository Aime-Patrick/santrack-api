# SANTRACK — Live Demo Runbook

One script for a full traceability demo: **factory → warehouse → shop → consumer → regulator**.

Use this document on the day. Do the **Before demo** section once; then follow **Acts 1–6** in order.

---

## Demo story (say this once at the start)

> “We follow one bottle of **Fresh Milk 1L** from **Rwanda Fresh Dairy** through the supply chain. Every scan updates a permanent record. At the end, a **consumer** checks authenticity without an account, and **RBSA** can see the whole industry.”

---

## Before demo (~30 minutes earlier)

### 1. Start services

**Local**

```bash
# Repo root — Postgres + Redis
docker compose up -d

# API
cd santrack-api
pnpm install
pnpm db:setup
pnpm migration:run
pnpm seed
pnpm start:dev          # http://localhost:8081

# Frontend (separate terminal)
cd tracer/frontend
pnpm install
pnpm dev                # http://localhost:3000
```

**Render (production demo)**

- API URL: your Render service (e.g. `https://santrack-api.onrender.com`)
- Frontend on Vercel with `NEXT_PUBLIC_API_URL` pointing at Render
- Demo users are created automatically if `SEED_ON_START=true` on Render (default in
  `render.yaml`). No pre-deploy needed — migrations + seed run in the **start command**.
- Or seed once from your machine using the Postgres **External Database URL** from Render:

```bash
cd santrack-api
DATABASE_URL="postgres://..." pnpm migration:run
DATABASE_URL="postgres://..." pnpm seed:prod
```

### 2. Smoke check

| Check | URL |
| --- | --- |
| API alive | `GET /api/health` → `{ "status": "ok" }` |
| Frontend loads | `/login` |
| Public verify | `/verify` |

### 3. Optional: relax rate limits (local only)

In API `.env`:

```env
RATE_LIMIT_LOGIN=0
RATE_LIMIT_REGISTER=0
RATE_LIMIT_VERIFY=0
```

Restart API after changing.

### 4. Keep these open in browser tabs

1. Login — `/login`
2. Consumer verify — `/verify`
3. This runbook

---

## Login cheat sheet

| Who | Email | Password | Organization |
| --- | --- | --- | --- |
| **Platform admin** (SAN TECH) | `admin@santrack.rw` | `admin123` | — |
| **Regulator** (MINICOM / RBSA) | `regulator@rbsa.rw` | `regulator123` | Rwanda Business Standards Agency |
| **Manufacturer** | `manufacturer@dairy.rw` | `mfg123` | Rwanda Fresh Dairy Ltd |
| **Warehouse** | `warehouse@store.rw` | `wh123` | Kigali Distribution Centre |
| **Retailer / shop** | `shop@retail.rw` | `shop123` | Kimironko Supermarket |
| **Consumer** | *(no account)* | — | Public `/verify` only |

> **Note:** Seed creates orgs and catalogue, **not** bottled stock. You will mint stock in Act 2 (Opening Stock).

---

## Act 1 — Platform admin (2 min)

**Login:** `admin@santrack.rw` / `admin123`

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 1.1 | **Dashboard** `/dashboard` | Show summary | “SAN TECH operates the platform; each business has its own workspace.” |
| 1.2 | **Industries** `/dashboard/industries` | List all seeded orgs | “Every manufacturer, warehouse and shop registers here with TIN.” |
| 1.3 | **Regulators** `/dashboard/regulators` | Show RBSA | “Regulators are granted by the platform — not self-signup.” |

**Logout** → next act.

---

## Act 2 — Manufacturer (8–10 min)

**Login:** `manufacturer@dairy.rw` / `mfg123`

### 2A — Compliance & licence (1 min)

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 2.1 | **Compliance → Overview** `/dashboard/compliance` | Show licence standing | “Production is tied to licence — RBSA issued **LIC-MFG-2026-001**.” |
| 2.2 | **Licenses & Permits** `/dashboard/licenses` | Open active licence | “Advisory mode: violations are recorded; strict mode can block operations.” |

### 2B — Mint opening stock (4 min)

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 2.3 | **Stock & Inventory → Opening Stock** `/dashboard/inventory/opening-stock` | Start adoption | “Existing warehouse stock enters the system once — not every day.” |
| 2.4 | Same screen | Product: **Fresh Milk 1L**, batch **DAI-2026-001**, location **Main Factory** | “Each bottle gets a unique identity.” |
| 2.5 | Choose **Type how many** (fastest for demo) | Enter **12** units | “In production we’d scan each bottle; here we declare the count.” |
| 2.6 | Complete registration | Wait for success | “12 traceable units now exist — each with QR + human code.” |

**Write down one unit QR token** from the result list (you need it in Act 5).

### 2C — Optional: pack into a box (2 min, skip if short on time)

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 2.7 | **Inventory** `/dashboard/inventory` → **Register package** | Create one **BOX** | “Cartons group bottles; scanning the box moves all contents.” |
| 2.8 | **Pack items** `/dashboard/manufacturing/pack` | Pack 6 bottles into the box | “Hierarchy: box → bottles.” |

### 2D — Dispatch to warehouse (2 min)

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 2.9 | **Inventory** → **Transfer stock** `/dashboard/manufacturing/stock-transfer` | Destination: **Kigali Distribution Centre** | “Chain of custody starts — goods leave the factory.” |
| 2.10 | Select the box **or** individual bottle QR codes | Submit transfer | “Status becomes **IN_TRANSIT** until the warehouse confirms.” |
| 2.11 | **Trace & Act** `/dashboard/manufacturing/trace` | Scan one bottle code | “Full timeline: manufactured → dispatched.” |

**Logout** → warehouse.

---

## Act 3 — Warehouse (5 min)

**Login:** `warehouse@store.rw` / `wh123`

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 3.1 | **Inventory** `/dashboard/inventory` | See incoming / in-transit stock | “Warehouse sees what is on the way.” |
| 3.2 | **Transfer stock** (receive flow on same page or transfer detail) | **Receive** the manufacturer transfer into **Main Warehouse** location | “Custody passes to Kigali DC — event is permanent.” |
| 3.3 | **Transfer stock** | New transfer → destination **Kimironko Supermarket** | “Partial dispatch: send part of stock to retail.” |
| 3.4 | Select items to send (box or bottles) | Submit | “Retailer must receive before they can sell.” |
| 3.5 | **Trace & Act** | Scan same bottle QR | “Timeline now shows factory → warehouse → dispatched to shop.” |

**Logout** → retailer.

---

## Act 4 — Retailer / shop (5 min)

**Login:** `shop@retail.rw` / `shop123`

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 4.1 | **Inventory** `/dashboard/inventory` | Receive warehouse transfer | “Shop confirms goods arrived.” |
| 4.2 | **Sales → New sale** `/dashboard/sales/new` | Type: **Consumer sale** | “Final step in the supply chain.” |
| 4.3 | Same screen | Consumer ref: e.g. `Walk-in customer` | “Light reference — not a consumer account.” |
| 4.4 | Scan or add the **bottle QR** from Act 2 | Complete sale | “Bottle is **SOLD** — still traceable, different holder.” |
| 4.5 | **Trace & Act** | Scan bottle again | “MANUFACTURED → … → RECEIVED → **SOLD**.” |

**Logout** → consumer (no login).

---

## Act 5 — Consumer verification (3 min)

**No login.** Open `/verify` in a **new tab** or on your phone.

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 5.1 | `/verify` | Paste or scan the **QR token** from Act 2 | “Anyone can verify — no account, no supplier names leaked to fraudsters.” |
| 5.2 | Result page `/verify/{token}` | Show **PRODUCT VERIFIED** | “Manufacturer, batch, dates, production location — trust at point of purchase.” |
| 5.3 | Try a fake code | e.g. `/verify/not-a-real-code` | “Unknown codes get a clear **could not be verified** warning.” |

---

## Act 6 — Regulator (5 min)

**Login:** `regulator@rbsa.rw` / `regulator123`

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 6.1 | **Industries** `/dashboard/industries` | Browse all businesses | “RBSA sees every registered operator and licence status.” |
| 6.2 | **Regulators → License Review** `/dashboard/regulator` | Show queue / findings | “Applications and compliance findings land here.” |
| 6.3 | **Analytics** `/dashboard/analytics` | Industry view | “Cross-industry picture — not limited to one factory.” |
| 6.4 | **Trace & Act** | Scan the same bottle QR | “Regulator sees **full chain including consumer sale** — more than public verify.” |
| 6.5 | **Recalls** `/dashboard/recall` | Show list (may be empty until Act 7) | “Regulator can initiate or monitor recalls industry-wide.” |

**Logout.**

---

## Act 7 — Recall (optional, 5 min)

**Login:** `regulator@rbsa.rw` or `manufacturer@dairy.rw`

| Step | Where | What to do | What to say |
| --- | --- | --- | --- |
| 7.1 | **Recalls** `/dashboard/recall` | Start recall for batch **DAI-2026-001**, reason e.g. “Lab test failure” | “One batch recall — system maps **who still holds stock**.” |
| 7.2 | Recall detail page | Show impact: sold vs recoverable | “Shops and warehouses know what to pull.” |
| 7.3 | **Consumer verify** again on same bottle | Show **warning / recalled** | “Consumer immediately sees product is not safe.” |
| 7.4 | **Maintenance** `/dashboard/maintenance` *(manufacturer)* | Destroy recalled stock if demoing lifecycle | “Physical destruction recorded on the chain.” |

---

## Role map (stakeholder ↔ system)

| Stakeholder (Pacifique) | SANTRACK |
| --- | --- |
| Manufacturer | Org type `MANUFACTURER` |
| Warehouse | Org type `WAREHOUSE` |
| Distributor / Retailer / SME shop | `DISTRIBUTOR` / `RETAILER` / `SHOP` |
| Consumer | `/verify` only |
| MINICOM / government | `REGULATOR` (platform-granted) |
| SAN TECH | `SYSTEM_ADMIN` |

---

## If something breaks

| Problem | Fix |
| --- | --- |
| Empty inventory after opening stock | Refresh; confirm batch **DAI-2026-001** and location selected |
| Transfer not receivable | Check destination org name matches seed exactly |
| Cannot sell | Receive transfer first; item must be **READY**, not **IN_TRANSIT** |
| Verify shows unknown | Use **qrCode token**, not the printed `ST-…` code |
| 429 / rate limit | Set `RATE_LIMIT_*=0` locally and restart API |
| Render cold start | Wait ~30s, retry `/api/health` |
| Sidebar missing items | Normal — menu is **capability-based** per org type |

---

## Alternative: production path (longer demo)

If you prefer **make fresh stock on the line** instead of Opening Stock:

1. **Manufacturing → Production** — new order for Fresh Milk 1L, qty 12  
2. **Start** → **Complete batch** → lot goes **PENDING_QC**  
3. **Quality Control** — approve lot  
4. **Confirm output** into stock  
5. Continue from **Act 2D** (dispatch)

Skip **Machine / Line** — leave blank.

---

## Timing guide

| Act | Minutes |
| --- | --- |
| 1 Platform admin | 2 |
| 2 Manufacturer | 8–10 |
| 3 Warehouse | 5 |
| 4 Retailer | 5 |
| 5 Consumer | 3 |
| 6 Regulator | 5 |
| 7 Recall (optional) | 5 |
| **Total** | **~30–35 min** |

---

## Quick URLs (local)

| Page | URL |
| --- | --- |
| Login | http://localhost:3000/login |
| Dashboard | http://localhost:3000/dashboard |
| Opening stock | http://localhost:3000/dashboard/inventory/opening-stock |
| Transfer | http://localhost:3000/dashboard/manufacturing/stock-transfer |
| New sale | http://localhost:3000/dashboard/sales/new |
| Trace & Act | http://localhost:3000/dashboard/manufacturing/trace |
| Verify | http://localhost:3000/verify |
| Regulator review | http://localhost:3000/dashboard/regulator |
| Recalls | http://localhost:3000/dashboard/recall |
| API docs | http://localhost:8081/api-docs |

---

*Last updated for seed data in `src/seed.ts` — Rwanda Fresh Dairy demo orgs.*
