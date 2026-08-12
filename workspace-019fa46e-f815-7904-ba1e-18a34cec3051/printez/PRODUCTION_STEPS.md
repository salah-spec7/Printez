# printez — Production Build Playbook

This document is a step-by-step engineering playbook to take the printez prototype from localStorage-mock to a production app that real Kharghar customers and shops can use. Each section picks a tool, explains why, shows the code migration pattern from the current `Data.*` API, and lists gotchas specific to Indian-market hyperlocal commerce.

---

## Recommended stack (and why)

For an Indian hyperlocal MVP, **Supabase** is the fastest, cheapest, and most-capable backend. It bundles Postgres, Auth, Realtime subscriptions, file Storage, and Edge Functions in one open-source platform. You can self-host it later if you outgrow the hosted version.

| Concern | Choice | Why |
|---|---|---|
| Database | **Supabase Postgres** | Relational (shops have many products have many orders), built-in RLS for data isolation, generous free tier |
| Auth | **Supabase Auth** + **MSG91** (OTP) | Phone OTP is native; MSG91 is cheap & reliable in India (₹0.12/SMS); Firebase Auth is the alternative |
| Payments | **Razorpay** (with PhonePe/Paytm UPI via Razorpay) | 90%+ of Indian e-commerce uses it; UPI, cards, wallets all in one; easy webhooks |
| File uploads | **Supabase Storage** | Resized variants for mugs/frames, signed URLs, direct upload from client |
| Realtime | **Supabase Realtime** (Postgres logical replication) | Free; order status pushes to the customer's tracking page automatically |
| Hosting | **Vercel** (customer/seller/admin static) + **Supabase Edge Functions** | HTTPS, edge network, preview deployments |
| Maps/distance | **MapmyIndia** (Indian data) or Google Maps with India bias | MapmyIndia has better Kharghar/Navi Mumbai addressing; Google has better autocomplete |
| Notifications | **WhatsApp Business API** (via Gupshup/Twilio/Interakt) + FCM/APNs push | Indian users live on WhatsApp; open rates 90%+ vs SMS 5% |
| PWA | **Workbox** (service worker) + Web Push API | Add-to-home-screen, offline catalog view, push notifications |

**Estimated timeline:** 6–8 weeks with one full-stack engineer, or 4 weeks with two (one frontend, one backend).

**Estimated monthly cost at launch (100 shops, 1000 MAU):**
- Supabase Pro: $25 (~₹2,100)
- Razorpay: 2% per transaction (no fixed)
- MSG91: ~₹500/month for OTPs
- Vercel Pro: $20 (~₹1,700) or free tier enough initially
- WhatsApp (Gupshup): ~₹0.65/msg, pay-per-use
- MapmyIndia: ~₹5,000/month entry plan or Google Maps $200 credit equivalent
- **Total fixed: ~₹10–15k/month + Razorpay 2% per order**

For the sections below, code examples use **Supabase JS v2**. Swap for your backend of choice (Firebase is roughly equivalent effort).

---

## 0. Prerequisite: set up the Supabase project (1 day)

1. Create a Supabase project at https://supabase.com → free tier is enough to launch.
2. Get the project URL and anon/public key.
3. Install the client:

```bash
npm install @supabase/supabase-js
```

4. Create `assets/js/supabase.js`:

```js
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
export const supabase = createClient(
  'https://xxxx.supabase.co',
  'eyJhbGciOi...your-anon-key'   // safe to ship client-side (RLS protects data)
);
```

Or, since printez is plain HTML/JS (no bundler), load via ESM CDN:

```html
<script type="module">
  import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
  window.sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
</script>
```

5. Install the Supabase CLI for migrations:
```bash
npm i -g supabase
supabase init
supabase link --project-ref xxxx
```

---

## 1. Database (migrate from localStorage → Postgres) — 4–5 days

### Step 1.1 — Schema design

Run this as a Supabase migration (`supabase migration new init_schema` then `supabase db push`):

```sql
-- Enable UUIDs
create extension if not exists "uuid-ossp";

-- Profiles (one per user, regardless of role). A single user can be a customer AND a shop owner.
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text unique not null,
  email text,
  role text not null default 'customer' check (role in ('customer','seller','admin')),
  created_at timestamptz default now()
);

-- Shops
create table shops (
  id uuid primary key default uuid_generate_v4(),
  owner_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  categories text[] not null default '{}',  -- ['print','gifting']
  address text not null,
  lat numeric, lng numeric,                 -- populated by geocoding (see item 7)
  status text not null default 'pending' check (status in ('pending','approved','suspended')),
  avg_rating numeric default 0,
  review_count int default 0,
  delivery_fee int default 39,              -- ₹
  free_delivery_threshold int default 500,  -- ₹
  lead_time_hours int default 24,
  created_at timestamptz default now()
);

-- Platform-curated product catalog (admin-controlled)
create table products (
  id text primary key,                      -- 'visiting_cards', 'mug', etc.
  name text not null,
  category text not null check (category in ('print','gifting')),
  tagline text,
  art text not null,                        -- 'pc','mug','sticker' key for SVG art
  is_gifting boolean default false,
  materials jsonb default '[]',             -- [{label,mult}]
  tiers jsonb,                              -- [[25,7],[100,3.5],[1000,1.5]]
  base_price numeric,
  unit text,                                -- 'pc','sq.ft'
  has_sides boolean default false,
  custom_size boolean default false,
  sizes text[],                             -- ['89x54 mm','90x54 mm']
  gift_opts jsonb,                          -- [{name,price,qty}]
  platform_owned boolean default true,
  is_active boolean default true
);

-- Shop→product listings (each shop sets its own price adjustment + active flag)
create table listings (
  id uuid primary key default uuid_generate_v4(),
  shop_id uuid not null references shops(id) on delete cascade,
  product_id text not null references products(id) on delete cascade,
  base_adj numeric default 0,               -- price offset vs platform base
  delivery_fee_override int,                -- if different from shop default
  is_active boolean default true,
  lead_time_hours int default 24,
  created_at timestamptz default now(),
  unique(shop_id, product_id)
);

-- Orders
create table orders (
  id text primary key,                       -- 'ORD-1001' human readable
  customer_id uuid references profiles(id),
  customer_name text not null,
  customer_phone text not null,
  shop_id uuid references shops(id),
  listing_id uuid references listings(id),
  product_id text not null references products(id),
  specs jsonb not null default '{}',         -- {material,sides,size,option}
  quantity int not null,
  unit_price numeric not null,
  total_amount int not null,                 -- ₹ integer (paise rounding done client-side or in edge fn)
  commission_rate numeric not null,          -- 0.15 or 0.25
  commission_amount int not null,
  shop_payout_amount int not null,
  status text not null default 'placed',
  payment_id text,                           -- razorpay_payment_id
  payment_status text default 'pending',     -- pending|paid|failed|refunded
  photo_url text,
  address text,
  lat numeric, lng numeric,
  delivery text default 'delivery',          -- 'delivery'|'pickup'
  rating int check (rating between 1 and 5),
  review text,
  created_at timestamptz default now()
);

-- Status timeline
create table order_timeline (
  id uuid primary key default uuid_generate_v4(),
  order_id text not null references orders(id) on delete cascade,
  status text not null,
  note text,
  at timestamptz default now()
);

create index on orders(customer_id);
create index on orders(shop_id);
create index on orders(status);
create index on order_timeline(order_id);
```

### Step 1.2 — Replace `Data.*` methods with Supabase queries

Replace each function in `assets/js/app.js`. Pattern:

```js
// BEFORE (localStorage)
const Data = {
  shops: ()=> DB.get(DB_KEYS.shops, []),
  shopById(id){ return this.shops().find(s=>s.id===id); },
  orders: ()=> DB.get(DB_KEYS.orders, []),
  saveOrders: (o)=> DB.set(DB_KEYS.orders, o),
  ...
};

// AFTER (Supabase)
const Data = {
  async shops(){
    const {data} = await sb.from('shops').select('*').eq('status','approved');
    return data;
  },
  async shopById(id){
    const {data} = await sb.from('shops').select('*').eq('id',id).single();
    return data;
  },
  async ordersForCustomer(customerId){
    const {data} = await sb.from('orders')
      .select('*, order_timeline(*)')
      .eq('customer_id', customerId)
      .order('created_at',{ascending:false});
    return data;
  },
  async ordersForShop(shopId){
    const {data} = await sb.from('orders')
      .select('*, order_timeline(*)')
      .eq('shop_id', shopId)
      .order('created_at',{ascending:false});
    return data;
  },
  async createOrder(order){
    const {data, error} = await sb.from('orders').insert(order).select().single();
    if(error) throw error;
    await sb.from('order_timeline').insert({order_id:data.id,status:'placed'});
    return data;
  },
  async advanceOrder(orderId, newStatus){
    await sb.from('orders').update({status:newStatus}).eq('id',orderId);
    await sb.from('order_timeline').insert({order_id:orderId,status:newStatus});
  },
  ...
};
```

Because Supabase uses promises, the calling pages become `async` (wrap render calls in `async function render(){...}` with `await Data.xxx()`).

### Step 1.3 — Row Level Security (RLS)

Without this, any user can read/write any row. Enable RLS and add policies:

```sql
alter table profiles enable row level security;
alter table shops enable row level security;
alter table listings enable row level security;
alter table orders enable row level security;
alter table order_timeline enable row level security;

-- Profiles: user can read/write their own; anyone with phone match can read (for phone lookup)
create policy "profiles self" on profiles for all using (auth.uid()=id) with check (auth.uid()=id);
create policy "profiles public read name" on profiles for select using (true);  -- only name/avatar, done via a view in production

-- Shops: public read for approved shops; owner can update their own; admin can do anything
create policy "shops read approved" on shops for select using (status='approved' or owner_id=auth.uid() or exists(select 1 from profiles where id=auth.uid() and role='admin'));
create policy "shops owner update" on shops for update using (owner_id=auth.uid());
create policy "shops admin all" on shops for all using (exists(select 1 from profiles where id=auth.uid() and role='admin'));
create policy "shops insert owner" on shops for insert with check (owner_id=auth.uid());

-- Orders: customer sees their own; shop sees theirs; admin sees all
create policy "orders customer" on orders for select using (customer_id=auth.uid());
create policy "orders shop"     on orders for select using (shop_id in (select id from shops where owner_id=auth.uid()));
create policy "orders admin"    on orders for all    using (exists(select 1 from profiles where id=auth.uid() and role='admin'));
create policy "orders insert customer" on orders for insert with check (customer_id=auth.uid());
create policy "orders update shop"   on orders for update using (shop_id in (select id from shops where owner_id=auth.uid()));
```

Test these policies — a customer must NOT be able to advance their own order status, a seller must NOT see other shops' orders, etc.

### Step 1.4 — Seed data as a migration

Create `supabase/seed.sql` with the 5 shops + 8 products as SQL `INSERT` statements (replacing the JS `seedIfNeeded()` function). Keep the product SVG art client-side — it doesn't need DB storage.

**Deliverable:** All `Data.*` calls promisified, pages async/await, RLS enabled, seed data in Postgres.
**Gotcha:** Replace all synchronous code paths — `render()` will be called after `await Data.xxx()` so add a loading skeleton for the interim.

---

## 2. Auth / OTP — 3–4 days

### 2.1 — Set up Supabase Phone Auth

In Supabase Dashboard → Authentication → Providers → Phone:
- Enable **Phone** provider.
- For production: choose **MSG91** as the SMS provider (cheapest in India, good deliverability) — enter your AuthKey and a MSG91 template ID (you need to register a template on DLT first; this takes 1–2 days in India).
- For development: use Supabase's built-in "development OTP" mode where the OTP prints to the Supabase console log (no SMS cost).

Alternatively, you can keep SMS delivery entirely with **MSG91** and use Supabase Auth's `verifyOtp` with `{"channel":"sms"}` and your own SMS send via an Edge Function. That gives tighter control over the OTP template (critical for DLT compliance in India).

### 2.2 — Customer login flow

```js
// customer/login.html
async function sendOTP(phone){
  // phone should be E.164: '+919000000001'
  const { error } = await sb.auth.signInWithOtp({ phone });
  if(error) return toast(error.message,'error');
  toast('OTP sent to +91 '+phone.slice(-10));
}

async function verifyOTP(phone, otp, nameIfNew){
  const { data, error } = await sb.auth.verifyOtp({ phone, token:otp, type:'sms' });
  if(error) return toast(error.message,'error');
  // If user is new, create profile
  if(data.user) {
    const { data:existing } = await sb.from('profiles').select('id').eq('id',data.user.id).single();
    if(!existing){
      await sb.from('profiles').insert({id:data.user.id, name:nameIfNew||'Shopper', phone, role:'customer'});
    }
  }
  toast('Welcome to printez!','success');
  const next = new URLSearchParams(location.search).get('next') || 'index.html';
  location.href = next;
}
```

### 2.3 — Seller signup + admin approval

1. Seller signs up with phone OTP → their profile is created with `role:'seller'`, shop row inserted with `status:'pending'`.
2. Dashboard shows "Your shop is pending admin approval. You'll get a WhatsApp when approved."
3. Admin gets a badge on the Shops sidebar item; clicking opens the shop application → **Approve** button updates `shops.status='approved'`.
4. A Supabase Edge Function triggers a WhatsApp (via Gupshup/Twilio) to the seller: "Your shop Shree Sai Printers is now live on printez! Start accepting orders."

```sql
-- Sellers don't get to set themselves as approved. Default is 'pending'; only admin changes it.
create policy "sellers no self-approve" on shops for update with check (
  (owner_id = auth.uid() and status = (select status from shops where id=shops.id))  -- owner cannot change status column
  or exists(select 1 from profiles where id=auth.uid() and role='admin')
);
```

### 2.4 — Admin login

Admin accounts use email/password (Supabase Auth email provider). Only emails in an `admins` table (or with `profiles.role='admin'`) get access to `/admin/*`. On `/admin/login.html`:

```js
await sb.auth.signInWithPassword({ email,password });
// Check role after login:
const {data:prof} = await sb.from('profiles').select('role').eq('id',sb.auth.user.id).single();
if(prof.role!=='admin'){ toast('Not an admin','error'); await sb.auth.signOut(); }
```

Create the first admin via a one-time seed script:
```sql
-- You create this user in Supabase Dashboard → Auth → Add user, then:
insert into profiles (id,name,phone,email,role) values ('<uuid>','Admin','','a@a','admin');
```

### 2.5 — Session handling

Replace the current `Auth.customer()` etc. with a Supabase listener so pages react to login/logout automatically:

```js
sb.auth.onAuthStateChange((event, session)=>{
  if(event==='SIGNED_IN') render();   // re-render page as logged-in
  if(event==='SIGNED_OUT'){ Auth.clearAll(); location.href='login.html'; }
});
```

`requireAuth('customer')` becomes:
```js
async function requireAuth(role){
  const {data:{user}} = await sb.auth.getUser();
  if(!user){ location.href='login.html?next='+encodeURIComponent(location.pathname.slice(location.pathname.lastIndexOf('/')+1)); return false; }
  const {data:p} = await sb.from('profiles').select('role').eq('id',user.id).single();
  if(role==='admin' && p.role!=='admin'){ location.href='login.html'; return false; }
  if(role==='seller' && p.role!=='seller' && p.role!=='admin'){ location.href='login.html'; return false; }
  return true;
}
```

### 2.6 — DLT compliance (India-specific gotcha!)

You must register:
1. A **principal entity ID (PEId)** on the DLT portal (via your company or a service like SMSHorizon/Exotel/MSG91 who assist).
2. Register your OTP header (sender ID like `PRNTEZ`).
3. Register the OTP message template: "Your printez verification code is {{otp}}. Valid for 10 mins. Do not share."
4. Until these are approved (5–10 business days), use Firebase Auth's built-in SMS or Twilio Verify as a fallback (they have their own DLT headers).

**Deliverable:** Real OTP via MSG91 for all users, session persistence via Supabase, RLS-enforced roles, DLT-registered templates.
**Gotcha:** Test OTP flow on real Indian SIMs on Airtel/Jio/Vi — SMS deliverability on Airtel is the hardest.

---

## 3. Payments (Razorpay) — 3 days

### 3.1 — Set up Razorpay

1. Create a Razorpay account, complete KYC (takes 1–3 days for instant activation if you have a GST certificate; otherwise use test mode).
2. Get Key ID + Key Secret (test keys start with `rzp_test_`).
3. Load the Razorpay JS checkout in `cart.html`:

```html
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
```

### 3.2 — Create an order from the client

```js
document.getElementById('pay').addEventListener('click', async ()=>{
  // 1. Call Supabase Edge Function to create a Razorpay Order (server-side, secret safe)
  const {data:orderData} = await sb.functions.invoke('create-order',{
    body: { items:cart, name, phone, address:line, pickup }
  });

  // 2. Open Razorpay Checkout
  const rzp = new Razorpay({
    key: RAZORPAY_KEY_ID,
    amount: orderData.amount,       // in paise (e.g. 141400 = ₹1,414)
    currency:'INR',
    name:'printez',
    description:'Print & gifting from Kharghar shops',
    order_id: orderData.rzpOrderId,
    prefill: { name, contact:'+91'+phone },
    theme: { color:'#c2410c' },
    modal: { ondismiss: ()=> toast('Payment cancelled','info') },
    handler: async (resp)=>{
      // 3. Verify payment signature on the server, then finalize orders
      const {data:finalized} = await sb.functions.invoke('verify-payment',{
        body: { ...resp, orderItems:orderData.normalizedItems, name, phone, line, pickup }
      });
      toast('Payment successful! 🎉','success');
      await sb.from('cart_items').delete().eq('customer_id', sb.auth.user().id);
      location.href='orders.html?highlight='+finalized.orderIds[0];
    }
  });
  rzp.open();
});
```

### 3.3 — Edge Function `create-order` (Supabase Edge Function)

```ts
// supabase/functions/create-order/index.ts
import { serve } from 'https://deno.land/std@0.190.0/http/server.ts';
import Razorpay from 'npm:razorpay@2.9.2';
const rzp = new Razorpay({ key_id: Deno.env.get('RZ_KEY'), key_secret: Deno.env.get('RZ_SECRET') });

serve(async (req)=>{
  const {items,name,phone,address,pickup} = await req.json();
  // Calculate totals (same math as client totals() but SERVER-SIDE to prevent tampering)
  const subtotal = items.reduce((s,i)=>s+i.unitPrice*i.quantity,0);
  const shopFees={};
  items.forEach(i=>{ shopFees[i.shopId]=Math.max(shopFees[i.shopId]||0, i.deliveryFee); });
  const delivery = subtotal>=500?0:Object.values(shopFees).reduce((a,b)=>a+b,0);
  const total = subtotal+delivery;

  const order = await rzp.orders.create({
    amount: Math.round(total*100),  // paise
    currency:'INR',
    payment_capture:1,              // auto-capture
    notes:{ customerPhone:phone }
  });
  return new Response(JSON.stringify({amount:order.amount, rzpOrderId:order.id, normalizedItems:items}), {headers:{'Content-Type':'application/json'}});
});
```

### 3.4 — Edge Function `verify-payment`

```ts
// Verify the razorpay_signature server-side (never trust client)
import crypto from 'node:crypto';
serve(async (req)=>{
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, orderItems, name, phone, line, pickup } = await req.json();
  const expected = crypto.createHmac('sha256', Deno.env.get('RZ_SECRET'))
    .update(razorpay_order_id+'|'+razorpay_payment_id).digest('hex');
  if(expected!==razorpay_signature) return new Response('bad sig',{status:400});

  // Create the orders in DB (inside a transaction)
  const created=[];
  for(const it of orderItems){
    const product = await supabase.from('products').select('category').eq('id',it.productId).single();
    const commRate = product.data.category==='gifting'?0.25:0.15;
    const total = Math.round(it.lineTotal);
    const {data:o} = await supabase.from('orders').insert({
      id:'ORD-'+Date.now()+Math.floor(Math.random()*1000),
      customer_id: it.customerId, customer_name:name, customer_phone:phone,
      shop_id:it.shopId, listing_id:it.listingId, product_id:it.productId,
      specs:it.specs, quantity:it.quantity, unit_price:it.unitPrice,
      total_amount:total, commission_rate:commRate,
      commission_amount:Math.round(total*commRate), shop_payout_amount:total-Math.round(total*commRate),
      status:'placed', payment_id:razorpay_payment_id, payment_status:'paid',
      address: pickup?'Pickup':line, delivery: pickup?'pickup':'delivery',
    }).select().single();
    await supabase.from('order_timeline').insert({order_id:o.id,status:'placed'});
    // Auto-assign if needed (see item 6)
    created.push(o.id);
  }
  return new Response(JSON.stringify({orderIds:created}),{headers:{'Content-Type':'application/json'}});
});
```

Deploy:
```bash
supabase functions deploy create-order --no-verify-jwt
supabase functions deploy verify-payment --no-verify-jwt
supabase secrets set RZ_KEY=rzp_live_xxx RZ_SECRET=xxxx
```

### 3.5 — Payouts to shops (post-launch)

For MVP, use **manual RazorpayX payouts** (weekly bank transfer to each shop based on the `shop_payout_amount - commission` reconciliation). Later, automate via RazorpayX API or Razorpay Route (marketplace split) which does it instantly:

```js
// After order delivered, split to shop's linked account:
await rzp.payments.transfer(paymentId, {
  transfers: orders.map(o=>({
    account: shop.razorpay_account_id,
    amount: o.shopPayoutAmount*100,  // paise
    currency:'INR',
    on_hold:0
  }))
});
```

This requires each shop to complete Razorpay KYC (link their bank account). For launch week, manual payouts are fine and reduce compliance load.

**Deliverable:** Real ₹ flow via Razorpay, server-side order/payment verification, commissions calculated server-side, platform fee (15%/25%) automatically held back.
**Gotchas:**
- All money math on the server (clients can tamper with ₹ amounts).
- Generate GST-compliant invoices (Shop's GSTIN + platform GSTIN) — for MVP just provide an "invoice" download; integrate with ClearTax/Razorpay Invoicing for proper e-invoicing if you cross ₹5L/month.
- For UPI recurring / AutoPay you don't need it — all orders are one-time.
- Razorpay test cards: `4111 1111 1111 1111` any CVV future date. UPI test: `success@razorpay`.

---

## 4. Photo upload (Supabase Storage) — 1 day

### 4.1 — Create a storage bucket

In Supabase Dashboard → Storage → "New bucket" called `order-photos`, set to **private** (signed URLs only).

Policy:
```sql
-- Customer can upload to their own order's photo; shop can read photos for their orders
create policy "photos upload own" on storage.objects for insert with check (
  bucket_id='order-photos' and (storage.foldername(name))[1] = auth.uid()::text
);
create policy "photos read shop" on storage.objects for select using (
  bucket_id='order-photos' and exists (
    select 1 from orders o join shops s on s.id=o.shop_id
    where o.id::text = (storage.foldername(name))[2] and s.owner_id=auth.uid()
  )
);
```

### 4.2 — Upload in the gifting config

```js
pu.addEventListener('click',()=>{
  const input = document.createElement('input');
  input.type='file'; input.accept='image/*';
  input.onchange = async (e)=>{
    const file = e.target.files[0];
    if(file.size>5*1024*1024){ toast('Photo under 5MB please','error'); return; }
    const user = sb.auth.user();
    const path = `${user.id}/order-${Date.now()}.jpg`;
    toast('Uploading…','info');
    const {error} = await sb.storage.from('order-photos').upload(path, file, {cacheControl:'3600',upsert:false,contentType:file.type});
    if(error){ toast(error.message,'error'); return; }
    const {data:url} = await sb.storage.from('order-photos').createSignedUrl(path, 60*60*24*30); // 30 days
    state.photoUrl = url.signedUrl; state.photoUploaded=true;
    toast('Photo attached','success'); render();
  };
  input.click();
});
```

Then store `state.photoUrl` in `specs.photo_url` when creating the order, pass to the shop and render on the seller's order detail.

### 4.3 — Display on seller order detail

```js
if(o.specs.photo_url){
  html += `<a href="${o.specs.photo_url}" target="_blank"><img src="${o.specs.photo_url}" style="max-width:200px;border-radius:12px"/></a>`;
}
```

**Deliverable:** Real image upload to Supabase Storage, access-controlled, visible to shop in order detail.
**Optional:** Resize to 1024px on upload via an Edge Function + Sharp (Squoosh the image to save storage/bandwidth).

---

## 5. Realtime / Push notifications — 2 days

### 5.1 — Supabase Realtime for order tracking

Enable the `orders` and `order_timeline` tables for realtime in Supabase Dashboard → Replication. Then on the customer order-detail page:

```js
function subscribeOrder(orderId){
  return sb.channel('order-'+orderId)
    .on('postgres_changes', {event:'UPDATE', schema:'public', table:'orders', filter:`id=eq.${orderId}`}, payload=>{
      // Animate the stepper forward
      toast(`Order updated: ${STATUS_LABEL[payload.new.status]}`,'success');
      currentOrder = payload.new;
      renderStepper();
    })
    .on('postgres_changes', {event:'INSERT', schema:'public', table:'order_timeline', filter:`order_id=eq.${orderId}`}, payload=>{
      currentTimeline.push(payload.new); renderStepper();
    })
    .subscribe();
}
```

Same pattern for seller: subscribe to `orders` where `shop_id=myShopId` so new orders appear with a "cha-ching" sound.

### 5.2 — Web push notifications (PWA)

1. Generate VAPID keys (in browser devtools or via `npx web-push generate-vapid-keys`).
2. In the service worker (item 6), subscribe to `pushManager` and save the subscription to a `push_subscriptions` table in Postgres.
3. When an order advances, an Edge Function calls Web Push to the customer/seller's browsers:

```ts
// Edge Function: send-push
import webpush from 'npm:web-push';
webpush.setVapidDetails('mailto:admin@printez.app', PUBLIC_VAPID, PRIVATE_VAPID);
const subs = await supabase.from('push_subscriptions').select('*').eq('user_id',userId);
for(const s of subs.data){
  await webpush.sendNotification(s, JSON.stringify({title:'printez', body:`Your order is now ${STATUS_LABEL[newStatus]}`, data:{orderId}}));
}
```

### 5.3 — WhatsApp notifications (higher ROI than push)

Via **Gupshup** or **Interakt** (India WhatsApp BSPs). After each status change, an Edge Function calls their API:

```ts
await fetch('https://api.gupshup.io/sm/api/v1/msg', {
  method:'POST',
  headers:{apikey:GUPSHUP_KEY,'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({
    channel:'whatsapp',source:GUPSHUP_NUMBER,destination:'91'+phone,
    'src.name':'printez',
    template:'{"id":"order_status_1","params':[STATUS_LABEL[newStatus],orderId]}
  })
});
```

This is the single biggest UX upgrade for India — users expect WhatsApp updates, not email.

**Deliverable:** Realtime order updates via Supabase subscription, push/WhatsApp notifications on each status change.
**Gotcha:** WhatsApp templates must be pre-approved by Meta; start with 3 templates: order_placed, order_status_update, out_for_delivery.

---

## 6. Service worker / PWA polish — 2 days

### 6.1 — Generate a service worker with Workbox

Create `sw.js` and register it from every page's `pageLoaded()`:

```js
if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
```

`sw.js` (using Workbox CDN for simplicity):

```js
importScripts('https://storage.googleapis.com/workbox-cdn/releases/7.0.0/workbox-sw.js');
workbox.precaching.precacheAndRoute(self.__WB_MANIFEST || []);
// App shell: cache core assets
workbox.routing.registerRoute(/\.(?:css|js|svg|png|jpg|webmanifest)$/, new workbox.strategies.CacheFirst({cacheName:'assets'}));
// HTML pages: network-first with offline fallback
workbox.routing.registerRoute(/(\/|\.html)$/, new workbox.strategies.NetworkFirst({
  cacheName:'pages',
  plugins:[new workbox.expiration.ExpirationPlugin({maxEntries:30})]
}));
// Offline fallback page
workbox.routing.setCatchHandler(async ({event})=>{
  if(event.request.destination==='document') return caches.match('/offline.html');
  return Response.error();
});
self.addEventListener('push',e=>{ /* display notification */ });
self.addEventListener('notificationclick',e=>{ clients.openWindow('/customer/orders.html'); });
```

### 6.2 — Add install prompt nudge

On the home page, if `beforeinstallprompt` fires, show a small "Add printez to home screen" button for first-time users (after they've placed an order).

### 6.3 — Background sync for offline orders (nice-to-have for V2)

The `BackgroundSync` plugin lets a customer click "Place order" offline and have the order sync when connectivity returns. Skip for MVP.

**Deliverable:** App is installable on Android Chrome+iOS Safari, works offline for already-loaded pages, push notifications land even when the tab is closed.
**Gotcha:** iOS Safari limits service-worker background sync; push on iOS requires the user to add to home screen first.

---

## 7. Geocoding / maps / delivery radius — 2–3 days

### 7.1 — Geocode shops & customer addresses

Use **MapmyIndia Mappls** (better for India, cheaper) or Google Maps Geocoding. Add a one-time script to geocode existing shop addresses:

```js
async function geocode(address){
  const url = `https://apis.mapmyindia.com/advancedmaps/v1/${MMI_KEY}/geo_code?addr=${encodeURIComponent(address)}`;
  const r = await fetch(url); const j = await r.json();
  return {lat:j.copResults[0].latitude, lng:j.copResults[0].longitude};
}
```

Store lat/lng on `shops.lat`, `shops.lng` and on the order when the customer enters their address.

### 7.2 — Distance check (Haversine for MVP, road-distance for V2)

```js
function distanceKm(lat1,lng1,lat2,lng2){
  const R=6371; const dLat=(lat2-lat1)*Math.PI/180, dLng=(lng2-lng1)*Math.PI/180;
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
```

On the product page, when a customer enters their address (or uses device location), filter `eligibleShops()` to those within 5km road distance. For a proper hyperlocal feel, compute delivery fee per km: `deliveryFee = baseFee + Math.round(distanceKm)*5`.

### 7.3 — Address autocomplete

Add MapmyIndia's **Autocomplete Widget** (`eloc`) in the cart address field — this gives accurate Indian addresses with sector/locality hints. Google Places Autocomplete also works with Indian addresses but MapmyIndia has better Kharghar/Navi Mumbai data since it's mapped by Indian surveyors.

### 7.4 — Tie into auto-assignment

Update `autoAssignOrder()` to prefer closest available eligible shop (current algorithm uses capacity+rating+price; add distance as a factor):

```js
withLoad.sort((a,b)=>{
  if(a.active>=5) return 1; if(b.active>=5) return -1;
  const distA = distanceKm(custLat,custLng,a.shop.lat,a.shop.lng);
  const distB = distanceKm(custLat,custLng,b.shop.lat,b.shop.lng);
  if(Math.abs(distA-distB)>1.5) return distA-distB;
  if(Math.abs(a.shop.avgRating-b.shop.avgRating)>0.3) return (b.shop.avgRating||0)-(a.shop.avgRating||0);
  return a.price-b.price;
});
```

**Deliverable:** Accurate address entry with autocomplete, delivery radius filtering, distance-aware auto-assignment, distance-based delivery fees.
**Gotcha:** Kharghar has many sectors; pin-code geocoding (410210) is too coarse. Street-level geocoding is essential.

---

## 8. Auto-assignment (tune so admin queue has work) — ½ day

Currently, because customers choose a shop on the product page (`state.listingId`), checkout immediately assigns. To give admin visibility and quality control:

**Option A (recommended for MVP):** Keep customer-chosen shop as a "requested shop" but set `status='placed'` at checkout with `shop_id=null` for orders over ₹500 or for shops with ≥5 active orders (capacity cap). Auto-assign immediately otherwise. This gives 1–2 orders in the queue daily for demo.

**Option B (two-sided marketplace feel):** At checkout, hold all orders as 'placed' with `shop_id=null`. Run an Edge Function every 5 minutes (pg_cron or Supabase cron) that auto-assigns pending orders using the algorithm. This is how Zomato/Swiggy work — there's a 1–3 minute "searching for best shop" animation on the customer tracking page while the system picks.

Add a `/customer/tracking.html` page with a "Finding best printer for you…" skeleton until `status!='placed'`.

**Option C:** Explicit "admin must approve every assignment" — not recommended, adds latency.

For launch I'd do **Option B** with a 2-minute assignment delay for realism. The customer sees the search animation (which feels premium), then the shop accepts/declines, then production starts.

### Auto-assign Edge Function (scheduled)

```sql
-- Enable pg_cron extension in Supabase:
create extension if not exists pg_cron;
select cron.schedule('auto-assign','* * * * *', $$
  -- every minute, assign any pending orders older than 2 minutes
  select assign_pending_orders();
$$);
```

Create the SQL function `assign_pending_orders()` that mirrors the JS `Data.autoAssignOrder()` (capacity + rating + price + distance).

**Deliverable:** Orders route to the optimal shop automatically with a visible "matching" animation on the customer tracker.
**Gotcha:** Shops should get 30 seconds to accept/decline on their dashboard; if they don't respond in time, reassign to next-best shop.

---

## 9. Multi-city expansion — 1 day (later)

The current "📍 Kharghar, Navi Mumbai" chip is hardcoded. To expand:

1. Add a `cities` table with `id (text 'kharghar'), name, lat, lng, radius_km, is_active`.
2. Add a city selector on the customer home page (like Swiggy's "Deliver to" dropdown), stored in `profiles.home_city_id` and in localStorage `pz_city`.
3. Topbar location chip shows the chosen city; clicking opens a city picker.
4. Filter shops, products, and orders by city (`shops.city_id` join).
5. Seed with Kharghar → then add Vashi, Belapur, Nerul (all Navi Mumbai) when you onboard shops there.
6. When a customer changes city, reset the catalog but keep their cart (with a warning "items available in Kharghar only" if product not available in the new city).

For launch, keep it single-city — hyperlocal works best when you go deep before going wide. Add the schema column now (easy migration) but don't build the UI until you're launching city #2.

---

## Launch order (do these in parallel)

1. **Week 1:** Supabase project, schema/RLS, migrate `Data.*` calls, phone OTP via Supabase dev-OTP
2. **Week 2:** Razorpay test mode integration, edge functions for order/payment verification, Storage for photo upload
3. **Week 3:** Realtime subscriptions, WhatsApp OTP + order notifications via Gupshup, MapmyIndia autocomplete, distance-based auto-assign
4. **Week 4:** Service worker / push, admin approval polish, seller earnings/payouts view
5. **Week 5:** Real Razorpay KYC, DLT/MSG91 live templates, onboard 5 real Kharghar shops (go meet them in person), beta test with 50 friends
6. **Week 6:** Fix beta feedback, add analytics (Plausible/Posthog), GST invoices, launch Kharghar
7. **Post-launch:** Multi-city, ratings+review moderation, discount codes, referral program, SEO for "printing services in Kharghar", delivery partner integration (Shadowfax/Dunzo for last-mile vs in-house)

## Compliance checklist for India

- ✅ GST registration (required for e-commerce marketplaces, 28% GST on platform fees, shop invoices to show their own GSTIN)
- ✅ DLT registration for OTP SMS (entity ID + template IDs)
- ✅ WhatsApp Business API (Meta BSP onboarding)
- ✅ Razorpay KYC + bank settlement
- ✅ Privacy Policy + Terms of Service (copy from Razorpay Payomatix; add DPDP Act 2023 compliance for data deletion requests)
- ✅ Print-shop onboarding: collect GSTIN, shop establishment license, owner ID
- ✅ Grievance officer email published (per DPDP Act)

## Shortcuts if you want to ship faster

| Instead of | Use | Time saved |
|---|---|---|
| Custom Node backend | Supabase | 2 weeks |
| Building your own OTP | Supabase dev OTP in dev, MSG91 in prod | 3 days |
| RazorpayX Route marketplace split | Manual weekly bank transfers in first month | 5 days |
| MapmyIndia full SDK | Static city list + Haversine for V1 | 2 days |
| Web push | Only WhatsApp notifications | 2 days |
| Custom admin panel | Use Supabase Studio for admin ops for first 2 weeks | 3 days |

This gets you to a usable Kharghar pilot in ~4 weeks. Come back to each shortcut after you have real users and revenue.
