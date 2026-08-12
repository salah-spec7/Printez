# printez — hyperlocal print & gifting marketplace (Kharghar)

A fully-working three-portal prototype for a hyperlocal marketplace connecting customers to local print & gifting shops in Kharghar, Navi Mumbai. All flows are real (localStorage mock backend) — catalog → configure → cart → checkout → live tracking → rating → seller fulfilment → admin oversight.

## Quick start

```bash
cd printez
# any static server works; e.g.:
python3 -m http.server 8765
# then open http://localhost:8765/
```

No build step, no dependencies to run. The only devDependency is `puppeteer` (used for the screenshot smoke-test script — `npm install` if you want to re-run `node shoot.js`).

## Three portals

| Portal | URL | Demo login |
|---|---|---|
| Customer storefront | `/customer/index.html` | Phone `9000000001` (Ananya R., has full order history) → any 6-digit OTP; or use the **Demo quick-login** buttons at the bottom of the login page. |
| Seller dashboard | `/seller/login.html` | Use the built-in **Demo accounts** quick-login buttons (Shree Sai Printers / Kharghar Gift Gallery / NaviMug Creations). Real OTP flow also works for any seeded shop phone. |
| Admin HQ | `/admin/login.html` | Email `a@a`, password `admin`. |

Portal hub at the root `/index.html` links to all three.

## What works end-to-end

### Customer
- Browse catalog (8 products across print & gifting), search, category filter (All / Print / Gifting)
- Product configurator with **live tiered bulk pricing**:
  - Print: material multiplier, single/double-sided (+70%), custom dimensions (banners sq.ft, stickers sq.in), quantity stepper + quick-tier chips, live "add X more → ₹Y" hint
  - Gifting: variant picker (mug/frame/greeting/t-shirt sub-options), quantity, mock photo upload
- Multi-shop comparison on each product (rating, lead time, delivery fee, per-unit price)
- Cart with per-shop delivery fees, **free delivery over ₹500**, pickup toggle, qty edit, remove
- Phone + OTP login (any 6 digits works in prototype), "demo quick-login" bypass
- Order tracking with **6-stage stepper** (Placed → Assigned → In Production → Ready → Out for Delivery → Delivered), each with timestamps
- Post-delivery 5★ rating + review → updates shop's average rating (triggers quality flag if <3.5★)
- Persistent address book, profile page with order stats

### Seller
- Signup form goes to admin approval queue (with OTP mock)
- Login, mobile-responsive sidebar + dashboard with today's stats, quick actions, active orders, your products
- Orders list with tabs (To prepare / Ready+Out / Delivered / All) → detail page with full accept→start→ready→out-for-delivery→delivered flow; reject triggers auto-reassignment
- Products list + "Add product" flow (active/inactive toggle)
- Shop profile, earnings page with commission breakdown (15% print / 25% gifting fees deducted)
- Low-rating warning card shows when avgRating drops below 3.5★

### Admin
- Overview with GMV, commission earned, pending approvals, unassigned orders, flagged shops
- Shops page: approve/suspend pending shops
- All-orders table across marketplace
- **Manual assignment** queue: pick a shop per order, or one-click auto-assign (capacity + rating + price algorithm)
- Catalog (platform-owned products view)
- Commission breakdown per shop, per category
- Quality page listing shops with avgRating < 3.5★

## Design system
- Warm orange brand (#c2410c), mobile-first, PWA-ready (`manifest.webmanifest`, theme-color, standalone display, Apple touch icon)
- Inter + Plus Jakarta Sans, Noto Color Emoji for emoji flags/ratings
- Mobile bottom tab bar (Shop/Cart/Orders/Me), desktop sidebars for seller/admin with mobile drawer
- Sticky checkout bars on mobile (Zomato/Swiggy-style)
- ₹ pricing with Indian locale formatting, en-IN dates

## Seed data
- 5 shops: 3 approved (Shree Sai Printers 4.6★, Kharghar Gift Gallery 4.2★, NaviMug Creations 3.2★ flagged) + 2 pending (Om Digital Prints, Bright Arts Studio)
- 8 products: Visiting Cards, Stickers, Banner Printing, Flyers & Brochures, Personalized Mug, Photo Frame, Custom Greeting Card, Custom T-Shirt
- 13 sample orders (6 for the demo customer "Ananya R." spanning every status; 7 more across other shoppers giving sellers/admins realistic volume)
- "From" prices match the spec: Visiting Cards ₹1.5/pc (1000+ bulk), Stickers ₹18/pc, Banners ₹12/sq.ft, Mugs ₹299, Frames ₹399, Greeting Cards ₹99, T-Shirts ₹499

## Project layout
```
printez/
├── index.html              portal hub
├── manifest.webmanifest    PWA manifest
├── assets/
│   ├── css/app.css         design system (~330 lines)
│   └── js/app.js           shared data layer, auth, pricing, SVG art, nav shells (~560 lines)
├── customer/               index, login, product, cart, orders, profile
├── seller/                 login, dashboard, orders, products, add-product, profile, earnings
├── admin/                  login, dashboard, shops, orders, assign, products, commission, quality
├── shoot.js                puppeteer screenshot smoke-test
├── PRODUCTION_PLAN.md      10-week roadmap + production stack recommendations
└── README.md
```

## Local "DB"
All state is in localStorage:
- `pz_shops_v1`, `pz_products_v1`, `pz_orders_v1`
- `pz_sess_cust_v1`, `pz_sess_sell_v1`, `pz_sess_adm_v1`
- `pz_cart_v1`, `pz_addr_v1`, `pz_customers_v1`
- `pz_seeded_v7` (bump version to force re-seed on next load)

Swap `Data.*` callsites for real `fetch()` endpoints and the UI works against a real backend unchanged.
