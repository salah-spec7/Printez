# printez — Production Readiness Plan

> Current state: a fully-working multi-portal prototype (customer storefront, seller dashboard, admin HQ) with localStorage-backed mock data. All three portals communicate through a shared "data layer" in `assets/js/app.js` — replacing those `Data.*` calls with real API calls is the main integration lift to production.

---

## 1. What's already built (today's prototype)

**File structure**
```
printez/
├── index.html                  ← Portal picker (hub)
├── assets/
│   ├── css/app.css             ← Shared design system (warm orange brand)
│   ├── js/app.js               ← Shared data layer + auth + helpers + SVG art
│   └── img/                    ← (for real product photos later)
├── customer/                   Storefront (PWA-style, mobile-first)
│   ├── index.html              Catalog with category chips, hero, shop picker
│   ├── product.html            Configurator with live tiered pricing
│   ├── cart.html               Address, delivery/pickup, mock payment
│   ├── orders.html             List + detail with stepper + ratings
│   ├── profile.html            Account / quick links / logout
│   └── login.html              Phone + OTP (mock)
├── seller/                     Shop dashboard (green accent)
│   ├── login.html              Sign in / sign up (OTP + demo quick-logins)
│   ├── dashboard.html          Stats, quick actions, active orders
│   ├── orders.html             List + detail with accept/start/ready/ofd/deliver
│   ├── products.html           Toggle on/off, add from catalog
│   ├── add-product.html        Add new SKU or onboard catalog item
│   ├── profile.html            Edit shop, rating, status
│   └── earnings.html           Payout history with date ranges
└── admin/                      HQ (indigo accent)
    ├── login.html
    ├── dashboard.html          KPIs, flags, recent orders
    ├── shops.html              Approve/reject/suspend/reinstate
    ├── orders.html             Filtered table (status/shop/date)
    ├── assign.html             Manual + auto-assignment to eligible shops
    ├── products.html           Catalog browser
    ├── commission.html         Date-range commission breakdown
    └── quality.html            Shop ratings with flagged <3.5★ warnings
```

**Flows that actually work end-to-end in the prototype**
1. Customer opens storefront → picks product → configures size/material/quantity (live price) → picks a Kharghar shop → adds to cart → signs in with phone + OTP → fills address (or chooses pickup) → "Pay now" → order is created, auto-assigned to an eligible shop → lands on tracking page with live stepper.
2. Seller signs in (or creates a new shop which lands in admin's approval queue) → sees new order → Accept → Start production → Mark Ready → Out for delivery / Pickup → Delivered.
3. Customer sees the stepper advance in real time on refresh; when delivered, can rate 1–5★ with feedback; shop's average rating recalculates automatically.
4. Admin approves pending shops → unassigned queue shows new orders → manual/auto-assign routes to best shop (by capacity + rating + price) → commission (15% print / 25% gifting) and payout calculated on every order → quality dashboard flags shops below 3.5★.

---

## 2. Architecture target for v1 production

**Principles**
- Mobile-first PWA for customers (no native app v1 — saves 3+ months)
- Server-rendered Next.js (or Remix) for SEO on catalog + fast first paint on 4G
- Dedicated React SPAs for seller/admin dashboards (served from `/seller` and `/admin`)
- Single Node/NestJS or Fastify API; Postgres + Redis; BullMQ for async jobs
- India-first primitives: Phone OTP auth, Razorpay/Cashfree payments, MapMyIndia for address validation, Dunzo/Shadowfax for delivery

**Recommended stack**
| Concern | Choice | Rationale |
|---|---|---|
| Frontend (customer) | Next.js 14 App Router + Tailwind + shadcn/ui, PWA enabled | SSR for catalog, great DX, shares design tokens easily |
| Frontend (seller/admin) | React + Vite (or same Next app on /seller /admin subpaths) | Faster iteration on internal tools, no SEO needed |
| API | Fastify (Node) or NestJS, Zod for request validation | Type-safe, fast, huge ecosystem |
| DB | Postgres (Supabase/Neon/RDS) + Prisma/Drizzle ORM | Relational orders, strong consistency, good geospatial |
| Cache/Queue | Redis (Upstash/Elasticache) + BullMQ | OTP rate limits, assignment jobs, webhook dedupe |
| Auth | Phone OTP via MSG91/Gupshup, httpOnly refresh JWT, optional TOTP for admin | India-expected UX, avoids email-password friction |
| Storage | Cloudflare R2 or S3 (fronted by Cloudflare CDN) | Cheap egress for artwork, uploads, invoice PDFs |
| Images | Next/image + AVIF/WebP, Sharp for thumbnail workers | Critical for 4G performance |
| Payments | Razorpay (primary) + Cashfree (fallback), Razorpay Route for split settlements | Best UPI intent flow; auto-split handles shop payouts |
| Delivery | Seller self-delivery v1; integrate Dunzo for Business / Shadowfax API v1.1 | Hyperlocal economics, pay-per-order |
| Notifications | FCM (push) + Gupshup WhatsApp Business + MSG91 SMS (transactional) | WhatsApp is the dominant channel in Kharghar |
| Maps/Address | MapMyIndia ELOC autocomplete | Better Indian address data than Google; cheaper |
| Search/Discovery | Postgres `tsvector` + trigram indexes <10k SKUs; Typesense after that | No infra to start |
| Analytics/Monitoring | PostHog (product) + Sentry (errors) + BetterStack (logs/uptime) | Affordable, GDPR/DPDP-friendly configs |
| Hosting | Vercel/Cloudflare Pages (web) + Railway/Fly (API) + Supabase (DB) | Ops-light for launch |
| GST/Invoicing | Internal PDF service (pdfkit or react-pdf) with HSN codes | Required from day one |

**Why not a BaaS?** Supabase can shave ~4 weeks off v1 and is a perfectly reasonable starting point. The reason I'd pick a dedicated API is that order-assignment + payment split + payout logic gets messy in RLS policies, and you want to version it.

---

## 3. Data model upgrades (Postgres)

```
users(id, phone UNIQUE, name, role, created_at, fcm_tokens[])
shops(id, owner_id, name, phone, gstin, address, lat/lng, service_radius_meters,
      categories[], status ENUM('pending','approved','suspended'),
      avg_rating, upi_id, payout_details, operating_hours, holiday_calendar, created_at)
products(id, platform_template_id NULL, shop_id NULL, name, category ENUM('print','gifting'),
         unit ENUM('pc','sq.ft','set'), tagline, art_key, is_live, base_price,
         tiers JSONB, materials JSONB, sizes JSONB, gift_opts JSONB, has_sides, custom_size,
         lead_time_hours, delivery_fee, created_at)
listings(id, shop_id, product_id, is_active, price_adjust, lead_time_hours, delivery_fee)
   -- platform catalog is virtual; shops list against it with their own price/lead
orders(id, code UNIQUE, customer_id, listing_id, shop_id, product_id,
       spec_snapshot JSONB, quantity, unit_price, subtotal, delivery_fee, total,
       platform_commission, shop_payout,
       payment_id ENUM('pending','captured','refunded'), refund_status,
       delivery ENUM('delivery','pickup'), address_text, lat/lng,
       status ENUM('placed','assigned','in_production','ready','out_for_delivery','delivered','cancelled'),
       placed_at, assigned_at, ...one ts per status..., delivered_at,
       assigned_expires_at, assigned_shop_deadline_at)
order_events(id, order_id, actor_type, actor_id, event_type, payload JSONB, at)
  -- append-only audit trail: every status change, message, photo, refund
reviews(id, order_id FK unique, shop_id, customer_id, rating INT 1..5, text, created_at)
otp_codes(id, phone, code_hash, purpose, expires_at, attempts)
payments(id, order_id, provider, provider_order_id, provider_payment_id, amount, status, webhook_log JSONB)
payouts(id, shop_id, period_start, period_end, amount, status, reference_id)
conversations + messages -- in-app chat between customer<->shop (moderated)
```

Key differences from the prototype:
- `listings` as a first-class join lets **multiple shops sell the same platform product at different prices/lead times** (you saw a hint of this today with the shop-picker on product pages).
- `order_events` is immutable — critical for disputes, refunds, customer support.
- `shop_id` is NULLABLE on products so sellers can add custom SKUs that don't yet exist on the platform catalog (today's "Add new product" flow seeds both product + listing).

---

## 4. Authentication & onboarding

**Customer** (storefront)
- Phone + OTP (WhatsApp first → SMS fallback). 6-digit TTL 5 min, rate-limit 5/number/day, Cloudflare Turnstile on send.
- Optional email later (for invoices)
- Allow guest **browse** but gate checkout/signup. This is what the prototype does (you can view catalog without signing in).

**Seller** (onboarding funnel — the most important growth lever)
1. Phone OTP → choose "Set up a new shop" or "I already have one"
2. Capture Shop name, Owner name, Pincode/address (MapMyIndia autocomplete), categories, GSTIN (optional but encouraged), PAN (optional for very small shops, required before payout)
3. Upload 3 sample photos (of the shop / past work) via direct-to-S3 signed URLs
4. Bank/UPI details for payouts (saved encrypted, KYC verified via Razorpay/KYC or Cashfree KYC)
5. Status becomes **pending**; admin reviews and approves (or asks for changes via a note)
6. After approval, the seller sees a "Catalog setup" wizard: pick platform products (adjust price/delivery/lead-time) or add their own custom SKUs. Until they have ≥1 live product, they don't appear in auto-assignment.

**Admin** (small trusted set)
- Email + password (or Google Workspace SSO) + TOTP; role granularity (`superadmin`, `ops`, `finance`, `support`).

---

## 5. Core product flows — production behavior

### A. Shop assignment algorithm
Auto-assignment fires via BullMQ job when an order is placed, retries every 60s until accepted or manual intervention. Scoring function:
```
score = distance_km * (-1) * W1
      + shop.avg_rating * W2
      + shop.on_time_pct * W3
      + shop.acceptance_rate * W4
      + (-abs(price - median_market_price)) * W5
      - active_order_load * W6
      + commission_margin * W7
```
Pick top shop, send push + WhatsApp "New order: ₹X — Accept within 90s". If no response, offer to #2. If none accept in 5 min → alert ops / show in admin's Unassigned queue.

### B. Order state machine (enforce transitions server-side)
```
placed → assigned → in_production → ready → out_for_delivery → delivered
                 ↘ cancelled (by shop/customer/admin before production)
ready → picked_up (if delivery=pickup, same terminal state as delivered)
any non-terminal → cancelled (with reason code, triggers refund)
delivered → refund_requested → refunded (admin-moderated within 7 days)
```
Each transition appends an `order_event`. Invalid transitions are rejected 400.

### C. Payment & refunds
- Razorpay Orders API → client-side JS SDK → webhook `payment.captured` is the **only** source of truth (never trust client success).
- Hold platform commission in your account; settle `shop_payout` to shop via Razorpay Route after T+2 (cooling-off for disputes).
- COD available for select shops/areas (toggle per shop). COD orders don't split settlement; reconcile cash manually or via Dunzo COD.

### D. Delivery
- v1: sellers mark OFD/Delivered themselves; proof-of-delivery photo optional; OTP from customer for delivery confirmation (auto-generated 4-digit code sent WhatsApp).
- v1.1: plug Dunzo for Business for delivery-option shops; auto-create task when order hits "ready", listen to Dunzo webhook for OFD/Delivered.
- Pickup: no delivery fee; customer gets a 6-digit pickup code.

### E. Customer notifications (timeline)
| Event | Channel |
|---|---|
| Placed | In-app + WhatsApp (confirm order + ETA) |
| Assigned | WhatsApp (shop name + phone) |
| In production | Push |
| Ready | WhatsApp + push ("Ready!" + pickup code / ETA for delivery) |
| Out for delivery | WhatsApp + partner phone + live tracking link (when Dunzo integrated) |
| Delivered | WhatsApp + push + in-app "Rate your order" card |

### F. Seller notifications
- New order offer: loud push + WhatsApp (opens seller app to Accept/Reject)
- Order approaching 30 min with no status move: nudge
- Daily earnings digest at 9 PM
- New review received: in-app + push

---

## 6. Seller portal deep dives (what the prototype covers today vs what production adds)

| Screen | In prototype | Production additions |
|---|---|---|
| Dashboard | Stats, quick actions, active orders list | Mini-chart (orders last 7 days), broadcast announcements from admin, "boost this product" promo ad |
| Orders | Accept/Reject/Start/Ready/OFD/Deliver, specs/customer view | Filter by status/search, download invoice PDF, print job-sheet PDF (for print-shop floor), batch print stickers/labels, assign to staff |
| Products | Toggle on/off, add from catalog, add custom SKU, price/lead-time/delivery fee | Bulk CSV import, per-SKU bulk pricing editor, variant matrix (material × size × sides), image upload per product, "vacation mode" (pause all listings) |
| Add product | Name/category/price/tiers | Image uploads (3–5), description/richtext, tags, size template picker, bulk tier table w/ live margin calculator |
| Profile | Edit name/owner/address, view rating | Bank/UPI verification status, KYC status, holiday calendar, service area on map, delivery radius slider, opening hours |
| Earnings | Date range, payout list | GST breakdown, downloadable GST-1 report, TDS deduction view, upcoming payout projections, invoice downloads |

**Seller-app-specific performance wins**
- Offline job-sheet: sellers often have bad Wi-Fi in press areas; cache the day's pending orders in IndexedDB and allow status updates to queue when offline (Background Sync).
- Thermal-printer support for job tickets (ESC/POS via Bluetooth) — many print shops need this.
- Tap-to-call / WhatsApp-customer buttons on the order (prototype has "Call" as a stub).

---

## 7. Customer storefront deep dives

| Screen | In prototype | Production additions |
|---|---|---|
| Catalog | Hero, category chips, "from ₹X" cheapest-offer cards | Search bar (trending → product, shop), filters (rating, fastest, cheapest, "near me"), sorting, recent searches saved |
| Product detail | Configurator, live price, shop picker, upload photo | Real image gallery (shop-specific), design-templates/canvas editor (fabric.js or Canva Embeds) for visiting cards/stickers (huge value-add), rating/reviews aggregate across all shops, "3 more shops offer this from ₹X" comparison, ETA per shop |
| Cart/Checkout | Address, delivery/pickup, pay now | Saved addresses, MapMyIndia autocomplete + lat/lng capture, phone prefilled, coupon/promo, UPI-intent detection (show GPay/PhonePe/Paytm buttons), order notes, COD toggle |
| Tracking | Status stepper | Live map (when OFD), delivery partner name+phone, in-app chat with shop (pre-filled contextual quick replies: "Is my order ready?"), timeline of actual times, photo-of-delivery, cancel button (only before in_production) |
| Me/Profile | Orders, quick links, logout | Saved addresses, wallet (refund credits), wishlist, referrals (₹100 off for referrer + referee), support/chat with printez |
| PWA | Manifest, theme color, installable | Service Worker (Workbox): offline shell, cached catalog images, Background Sync for queued add-to-cart/pay, push notifications via FCM, Add-to-Home-screen prompt after 2nd visit |

---

## 8. Admin HQ deep dives

| Screen | In prototype | Production additions |
|---|---|---|
| Overview | KPIs, flags, recent orders | Live feed (new order, new signup, new dispute), SLO cards ("p90 time-to-assign: 47s"), revenue sparkline |
| Shops | Approve/reject/suspend | Full KYC review, document viewer, notes/comments thread per shop, messaging shop (intercom-style), commission % override per shop |
| Orders | Filter by status/shop/date | Click-through to order drawer with customer/shop call buttons, full event timeline, manual refund, order edit, download invoice, flag for fraud |
| Assign | Manual + auto-assign | "Assignment reason" log, forced reassign, shop capacity override (max active orders) |
| Catalog | Product list | Create/edit platform templates, merge duplicate seller SKUs into platform catalog, enforce brand/quality standards |
| Commission | Date range, shop breakdown | Payout generation (T+2/T+7), TDS deduction, GST tax collected @ source, export CSV for CA, payout status (pending/processed/failed) |
| Quality | Shop ratings + flagging | Auto-threshold actions: warn at 3.5★, throttle orders at 3.0★, suspend at 2.5★ (configurable); review highlights (negative reviews bubble up); seller responses to reviews |
| *Missing needed pages:* | | **Promos/coupons**, **Announcements** (broadcast push), **Support tickets**, **Fraud/risk**, **Audit log** |

---

## 9. Infrastructure and reliability

- **Environments**: local → staging (prod-like, real Razorpay test mode, fake OTP=000000) → production. Every PR builds a preview.
- **CI/CD**: GitHub Actions → lint + typecheck + Playwright smoke (checkout happy path) → deploy preview → prod after manual approve.
- **Testing**:
  - Unit tests for pricing math (tier/area/commission — bug magnets), state machine, assignment scorer
  - Integration tests for order + payment webhook flows (against a Stripe-like Razorpay test harness)
  - 5–10 Playwright E2E flows (signup → order → seller fulfil → delivered → rated)
- **Observability**:
  - Sentry: frontend + backend errors, release tracking
  - BetterStack: logs + uptime monitors on checkout + payment webhook endpoints
  - PostHog: funnels (view → configure → add → pay) per category, per shop
  - Business dashboards in Grafana/Metabase: orders/hour, p90 assign time, p90 fulfilment time, COD remittance rate, refund rate
- **Backups**: Postgres daily + PITR; test restore monthly.
- **Rate limits** on OTP (phone+IP), on checkout (per customer+IP), on admin endpoints.
- **Secrets** in Doppler or AWS Secrets Manager — never in env files in repo.

---

## 10. India-specific compliance (don't ship without)

1. **DPDP Act 2023**: publish Privacy Policy; appoint a Grievance Officer; consent banners; honor data-deletion requests within 15 days; sign DPAs with vendors (Razorpay, Gupshup, etc.).
2. **GST**:
   - HSN/SAC codes: printing services ~9989, personalized gifts vary by SKU
   - Collect GSTIN from B2B customers (optional); always collect from sellers
   - Issue GST-compliant invoices (for each platform fee invoice to sellers; sellers issue their own invoice to customer, printez issues a consolidated invoice of platform fees monthly)
   - File GSTR-1/GSTR-3B monthly; use a provider like ClearTax or IRIS if >₹5L/month
3. **Payments**: RBI guidelines — store only last-4 of cards, all settlements via bank, nodal account description in ToS. Both Razorpay and Cashfree handle most of this but you'll need to publish your own:
   - Terms of Service
   - Refund & Cancellation Policy (display at checkout)
   - Shipping/Delivery Policy
   - Grievance Officer email + phone in footer
4. **WhatsApp policy**: Business verification, opt-in for marketing messages (keep order confirmations as transactional).
5. **Content moderation**: review user-uploaded photos (auto-hash NSFW + human queue for reported content).
6. **Shop liability**: seller agreement indemnifies printez for print defects/goods quality; printez handles marketplace moderation.

---

## 11. Launch roadmap (10 weeks to MVP, Kharghar only)

| Week | Milestone |
|---|---|
| 1 | Project scaffold (monorepo: Next.js web + Fastify API + Prisma schema + Redis). CI/CD. |
| 2 | Auth (phone OTP), user/shop/order/product/listings schemas, migrations, seeds (port the existing mock data). |
| 3 | Customer: catalog + product config + cart + address, against real API. Design system cleanup (port CSS). |
| 4 | Seller: signup, onboarding, login, dashboard orders list + accept/start/ready/OFD/delivered, profile. |
| 5 | Admin: login, shop approvals, orders list, manual/auto assign. Push notifications via FCM. |
| 6 | Razorpay integration (test mode), split settlements via Razorpay Route, refund flow, order state machine enforced server-side. |
| 7 | WhatsApp transactional (Gupshup) on every status change; customer tracking page; rating/review. |
| 8 | Seller product management (list against catalog + custom SKUs), seller earnings/payout view, PDF invoices. |
| 9 | Admin commission/payout tool, quality dashboard, MapMyIndia address autocomplete, PWA polish (SW, offline). |
| 10 | Beta with 5–10 Kharghar shops (shadow mode, don't charge commission), bug bash, GST/legal pages, production infra, switch on live payments in Kharghar. |

**Post-MVP (months 2–4)**
- Dunzo/Shadowfax delivery integration (take delivery burden off shops)
- Canvas/design editor for visiting cards & stickers
- Referral program + promo codes
- Expand node by node: Seawoods → Belapur → Vashi → Panvel → rest of Navi Mumbai
- Marathi/Hindi language toggle
- Seller thermal-printer ESC/POS support

---

## 12. What NOT to over-engineer at v1

- ❌ Native iOS/Android apps — PWA is enough for your first 10,000 customers in Kharghar; 90% will order via WhatsApp links anyway.
- ❌ Self-hosted ML/AI recommendation engine (no data yet; "people also bought" is static).
- ❌ Microservices — one API + one worker is fine to 100 orders/day; split only when queues or billing domains become painful.
- ❌ Building your own delivery fleet. Use aggregators.
- ❌ Multi-city before you nail unit economics in one node. Hyperlocal fails when density is too low.

---

## 13. Quickest next-step: running the prototype

```bash
cd printez
python3 -m http.server 8765
# open http://localhost:8765
```

Or just open `printez/index.html` directly in a browser (it uses no modules/imports so file:// works too).

**Suggested first walkthrough:**
1. Start at hub → **I'm a customer** → Sign in with any 10-digit number + any 6-digit OTP.
2. Order a set of Visiting Cards or a Mug, go through checkout (any name/address works, Pay Now simulates payment).
3. Go back to hub → **I run a shop** → use "Shree Sai Printers" demo login (bypass OTP).
4. Advance the order through Accept → Start → Ready → Out for Delivery → Delivered.
5. Back to customer → Orders → rate 5★.
6. Back to hub → **Platform admin** (use pre-filled creds admin@printez.app / admin123).
7. Approve the pending shops (Om Digital Prints, Bright Arts Studio); check the Unassigned tab; visit Quality to see NaviMug flagged at 3.2★.
8. Log out as a shop → Sign up a new shop; it'll land in admin's approval queue.
