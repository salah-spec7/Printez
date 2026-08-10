import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, Check, CircleUserRound, Clock3, LocateFixed,
  MapPin, Menu, Minus, Plus, Search, ShoppingBag, Sparkles, X,
} from 'lucide-react';
import { supabase } from './lib/supabase';

const INR = (paise) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;
const DEFAULT_LOC = { latitude: 19.0473, longitude: 73.0698, label: 'Kharghar, Navi Mumbai' };
const ICONS = { visiting_cards: 'VC', stickers: 'ST', banners: 'BN', flyers: 'FL', mug: 'MG', frame: 'FR', greeting: 'GC', tshirt: 'TS' };
const STATUS_FLOW = ['placed','assigned','in_production','ready','out_for_delivery','delivered'];

function distKm(a, b) {
  if (!a?.latitude || !b?.latitude) return null;
  const R = 6371, toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude), dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat/2)**2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1-h));
}

function priceFrom(product, listing, qty = 1) {
  const adj = listing?.base_adjustment_paise ?? 0;
  if (product.category === 'gifting') return (product.gift_options?.[0]?.price_paise ?? 0) + adj;
  const tiers = [...(product.tiers ?? [])].reverse();
  const tier = tiers.find(([t]) => qty >= t) ?? product.tiers?.[0];
  return (tier?.[1] ?? 0) + adj;
}

function App() {
  const [session, setSession] = useState(null);
  const [products, setProducts] = useState([]);
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState('home');
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState([]);
  const [selected, setSelected] = useState(null);
  const [location, setLocation] = useState(DEFAULT_LOC);
  const [locBusy, setLocBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s);
      if (s && page === 'login') setPage('home');
    });
    return () => sub.subscription.unsubscribe();
  }, [page]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [pr, li] = await Promise.all([
        supabase.from('products').select('*').eq('active', true).order('category').order('name'),
        supabase.from('shop_listings')
          .select('id,product_id,lead_time_hours,delivery_fee_paise,base_adjustment_paise,shops!inner(id,name,address,sector,latitude,longitude,avg_rating,review_count)')
          .eq('active', true).eq('shops.status', 'approved'),
      ]);
      if (pr.error || li.error) setError('We could not load the local catalog. Please try again.');
      else { setProducts(pr.data ?? []); setListings(li.data ?? []); }
      setLoading(false);
    })();
  }, []);

  const visible = useMemo(() => products.filter((p) => {
    const cat = category === 'all' || p.category === category;
    const q = search.trim().toLowerCase();
    return cat && (!q || `${p.name} ${p.tagline}`.toLowerCase().includes(q));
  }), [category, products, search]);

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);
  const cartTotal = cart.reduce((s, i) => s + i.unitPrice * i.quantity, 0);

  function useLoc() {
    if (!navigator.geolocation) return;
    setLocBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude, label: 'Near you' }); setLocBusy(false); },
      () => setLocBusy(false), { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  function go(p) { setPage(p); window.history.pushState({}, '', p === 'home' ? '/' : `/${p}`); }
  function addToCart(item) { setCart((c) => [...c, item]); setSelected(null); }
  function removeFromCart(i) { setCart((c) => c.filter((_, idx) => idx !== i)); }

  if (page === 'login') return <LoginPage onBack={() => go('home')} />;
  if (page === 'orders') return <OrdersPage session={session} onBack={() => go('home')} onLogin={() => go('login')} />;

  return (
    <div className="min-h-screen bg-ink-50 pb-24">
      <Header session={session} cartCount={cartCount} onLogin={() => go('login')} onHome={() => go('home')} onOrders={() => go('orders')} />
      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Hero */}
        <section className="relative mt-5 overflow-hidden rounded-[28px] bg-brand-800 px-6 py-10 text-white sm:px-10 sm:py-14" style={{boxShadow:'0 24px 60px -30px rgba(124,45,18,.8)'}}>
          <div className="relative z-10 max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/12 px-3 py-1.5 text-xs font-bold uppercase tracking-[.14em] text-brand-100"><Sparkles size={14}/> Made around Kharghar</div>
            <h1 className="font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl">Good ideas deserve a great print.</h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-brand-100 sm:text-lg">Compare trusted local shops, customize in seconds, and get your work delivered without leaving the neighbourhood.</p>
            <div className="mt-7 flex flex-wrap gap-3 text-sm font-semibold text-brand-50">
              {['Nearby shops','Clear prices','Fast turnaround'].map((t) => <span key={t} className="rounded-full border border-white/15 bg-white/10 px-3 py-2">{t}</span>)}
            </div>
          </div>
          <div className="absolute -right-20 -top-20 h-72 w-72 rounded-full border-[32px] border-brand-500/40" />
          <div className="absolute -bottom-28 right-20 h-72 w-72 rounded-full bg-brand-600/40 blur-2xl" />
        </section>

        {/* Search + categories */}
        <section className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-700">Your local print shelf</p>
            <h2 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">What are you making?</h2>
          </div>
          <button onClick={useLoc} disabled={locBusy} className="inline-flex items-center justify-center gap-2 rounded-xl border border-ink-200 bg-white px-4 py-2.5 text-sm font-semibold text-ink-700 transition hover:border-brand-400 hover:text-brand-700">
            <LocateFixed size={16} className={locBusy ? 'animate-pulse' : ''}/> {location.label}
          </button>
        </section>

        <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="flex min-h-12 flex-1 items-center gap-3 rounded-2xl border border-ink-200 bg-white px-4 text-ink-500 shadow-sm focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-100">
            <Search size={19}/>
            <input value={search} onChange={(e) => setSearch(e.target.value)} className="w-full bg-transparent text-sm text-ink-900 outline-none placeholder:text-ink-500" placeholder="Search cards, mugs, banners..."/>
          </label>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {[['all','Everything'],['print','Print'],['gifting','Gifting']].map(([v,l]) => (
              <button key={v} onClick={() => setCategory(v)} className={`whitespace-nowrap rounded-xl px-4 py-3 text-sm font-bold transition ${category === v ? 'bg-ink-900 text-white' : 'border border-ink-200 bg-white text-ink-700 hover:border-ink-400'}`}>{l}</button>
            ))}
          </div>
        </div>

        {error && <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}
        {loading ? <LoadingGrid/> : visible.length ? <ProductGrid products={visible} listings={listings} location={location} onSelect={setSelected}/> : <EmptyState/>}
      </main>

      <MobileNav cartCount={cartCount} onCart={() => setSelected({ cart: true })} onLogin={() => go('login')} onOrders={() => go('orders')} />
      <AnimatePresence>
        {selected && (selected.cart
          ? <CartDrawer cart={cart} total={cartTotal} onClose={() => setSelected(null)} onRemove={removeFromCart} onLogin={() => go('login')} session={session}/>
          : <Configurator product={selected} listings={listings.filter((l) => l.product_id === selected.id)} location={location} onClose={() => setSelected(null)} onAdd={addToCart}/>)}
      </AnimatePresence>
    </div>
  );
}

function Header({ session, cartCount, onLogin, onHome, onOrders }) {
  return (
    <header className="sticky top-0 z-30 border-b border-ink-200/80 bg-ink-50/90 backdrop-blur-xl">
      <div className="mx-auto flex h-[72px] max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
        <button onClick={onHome} className="flex items-center gap-2.5">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 font-display text-sm font-extrabold text-white shadow-lg shadow-brand-700/20">pz</span>
          <span className="font-display text-lg font-extrabold tracking-tight">printez</span>
        </button>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onOrders} className="hidden items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-ink-700 transition hover:bg-white sm:inline-flex"><Clock3 size={17}/>Orders</button>
          <button aria-label="Cart" onClick={() => window.dispatchEvent(new CustomEvent('open-cart'))} className="relative grid h-10 w-10 place-items-center rounded-xl text-ink-700 transition hover:bg-white">
            <ShoppingBag size={19}/>
            {cartCount > 0 && <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-brand-600 px-1 text-[10px] font-extrabold text-white">{cartCount}</span>}
          </button>
          <button onClick={onLogin} className="hidden items-center gap-2 rounded-xl border border-ink-200 bg-white px-3 py-2 text-sm font-bold text-ink-700 transition hover:border-brand-400 hover:text-brand-700 sm:inline-flex"><CircleUserRound size={17}/>{session ? 'Account' : 'Sign in'}</button>
          <button className="grid h-10 w-10 place-items-center rounded-xl border border-ink-200 bg-white text-ink-700 md:hidden"><Menu size={18}/></button>
        </div>
      </div>
    </header>
  );
}

function ProductGrid({ products, listings, location, onSelect }) {
  return (
    <section className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">
      {products.map((p, i) => {
        const pl = listings.filter((l) => l.product_id === p.id);
        const cheapest = pl.slice().sort((a, b) => priceFrom(p, a) - priceFrom(p, b))[0];
        const dists = pl.map((l) => distKm(location, l.shops)).filter(Boolean);
        return (
          <motion.button key={p.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * .04 }}
            onClick={() => onSelect(p)}
            className="group flex min-w-0 flex-col overflow-hidden rounded-2xl border border-ink-200 bg-white text-left card-shadow transition hover:-translate-y-1 hover:border-brand-400">
            <div className={`relative grid aspect-square place-items-center overflow-hidden ${p.category === 'print' ? 'bg-brand-50' : 'bg-rose-50'}`}>
              <div className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/60"/>
              <span className={`relative grid h-20 w-20 rotate-[-6deg] place-items-center rounded-2xl border-2 bg-white font-display text-xl font-extrabold shadow-md transition group-hover:rotate-0 ${p.category === 'print' ? 'border-brand-300 text-brand-700' : 'border-rose-300 text-rose-700'}`}>{ICONS[p.id] ?? 'PZ'}</span>
              <span className="absolute left-3 top-3 rounded-full bg-white/80 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-700">{p.category}</span>
            </div>
            <div className="flex flex-1 flex-col p-3.5 sm:p-4">
              <h3 className="font-display text-sm font-extrabold leading-tight text-ink-900 sm:text-base">{p.name}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-500">{p.tagline}</p>
              <div className="mt-4 flex items-end justify-between gap-2">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-ink-500">From</p>
                  <p className="font-display text-lg font-extrabold text-brand-700">{cheapest ? INR(priceFrom(p, cheapest)) : '—'}<span className="ml-1 text-[10px] font-semibold text-ink-500">/{p.unit}</span></p>
                </div>
                <ArrowRight size={18} className="text-brand-600 transition group-hover:translate-x-1"/>
              </div>
              <p className="mt-3 flex items-center gap-1 text-[11px] font-semibold text-ink-500"><MapPin size={12}/> {dists.length ? `${Math.min(...dists).toFixed(1)} km away` : cheapest?.shops?.sector ?? 'Kharghar'}</p>
            </div>
          </motion.button>
        );
      })}
    </section>
  );
}

function Configurator({ product, listings, location, onClose, onAdd }) {
  const [quantity, setQuantity] = useState(product.category === 'print' ? 100 : 1);
  const [listingId, setListingId] = useState(listings[0]?.id ?? '');
  const [giftIdx, setGiftIdx] = useState(0);
  const [matIdx, setMatIdx] = useState(0);
  const [sides, setSides] = useState('single');
  const [photoName, setPhotoName] = useState('');

  const listing = listings.find((l) => l.id === listingId) ?? listings[0];
  const unitPrice = product.category === 'gifting'
    ? (product.gift_options?.[giftIdx]?.price_paise ?? 0) + (listing?.base_adjustment_paise ?? 0)
    : priceFrom(product, listing, quantity) * (product.materials?.[matIdx]?.mult ?? 1) * (sides === 'double' ? 1.7 : 1);
  const total = unitPrice * quantity;
  const nearby = listings.slice().sort((a, b) => (distKm(location, a.shops) ?? 99) - (distKm(location, b.shops) ?? 99));

  return (
    <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/45 backdrop-blur-sm sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-ink-50 p-5 shadow-2xl sm:rounded-[28px] sm:p-7" initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.14em] text-brand-700">Customize your {product.category}</p>
            <h2 className="mt-1 font-display text-2xl font-extrabold tracking-tight">{product.name}</h2>
            <p className="mt-1 text-sm text-ink-500">Choose your finish, quantity, and the shop you trust.</p>
          </div>
          <button onClick={onClose} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-ink-700"><X size={19}/></button>
        </div>

        <div className="mt-6 space-y-4">
          {nearby.length > 1 && (
            <div className="rounded-2xl border border-brand-200 bg-brand-50 p-4">
              <p className="mb-3 text-sm font-extrabold text-brand-900">Choose a nearby shop</p>
              <div className="space-y-2">
                {nearby.map((l) => (
                  <label key={l.id} className={`flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-3 transition ${listing?.id === l.id ? 'border-brand-500 ring-2 ring-brand-100' : 'border-ink-200'}`}>
                    <input type="radio" checked={listing?.id === l.id} onChange={() => setListingId(l.id)} className="accent-brand-700"/>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-ink-900">{l.shops.name}</p>
                      <p className="mt-0.5 text-xs text-ink-500">{l.shops.sector} · {distKm(location, l.shops)?.toFixed(1) ?? '—'} km · {l.lead_time_hours}h</p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-sm font-extrabold text-brand-700">{INR(priceFrom(product, l, quantity))}</p>
                      <p className="text-[10px] font-semibold text-ink-500">{l.shops.avg_rating ? `${l.shops.avg_rating}★` : 'New'}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {product.materials?.length > 0 && (
            <Field label="Material / finish">
              <select value={matIdx} onChange={(e) => setMatIdx(Number(e.target.value))} className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-semibold text-ink-900">
                {product.materials.map((m, i) => <option key={m.label} value={i}>{m.label}</option>)}
              </select>
            </Field>
          )}

          {product.sizes?.length > 0 && (
            <Field label="Size">
              <select className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-semibold text-ink-900">
                {product.sizes.map((s) => <option key={s}>{s}</option>)}
              </select>
            </Field>
          )}

          {product.has_sides && (
            <Field label="Printed sides">
              <div className="grid grid-cols-2 gap-2">
                {[['single','Single-sided'],['double','Double-sided +70%']].map(([v, l]) => (
                  <button key={v} onClick={() => setSides(v)} className={`rounded-xl border px-3 py-3 text-sm font-bold ${sides === v ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-700'}`}>{l}</button>
                ))}
              </div>
            </Field>
          )}

          {product.category === 'gifting' && (
            <Field label="Variant">
              <div className="space-y-2">
                {product.gift_options?.map((o, i) => (
                  <button key={o.name} onClick={() => setGiftIdx(i)} className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left text-sm font-bold ${giftIdx === i ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-ink-200 bg-white text-ink-700'}`}>
                    <span>{o.name}</span><span>{INR(o.price_paise)}</span>
                  </button>
                ))}
              </div>
            </Field>
          )}

          {product.category === 'gifting' && (
            <label className="block rounded-2xl border-2 border-dashed border-ink-300 bg-white p-5 text-center transition hover:border-brand-500 hover:bg-brand-50">
              <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => setPhotoName(e.target.files?.[0]?.name ?? '')}/>
              <Sparkles className="mx-auto text-brand-600" size={24}/>
              <p className="mt-2 text-sm font-extrabold">{photoName || 'Add your personalization photo'}</p>
              <p className="mt-1 text-xs text-ink-500">JPG, PNG, or WebP · up to 10 MB</p>
            </label>
          )}

          <Field label="Quantity">
            <div className="flex items-center gap-3">
              <button onClick={() => setQuantity((v) => Math.max(1, v - (product.category === 'print' ? 25 : 1)))} className="grid h-12 w-12 place-items-center rounded-xl border border-ink-200 bg-white text-ink-800"><Minus size={18}/></button>
              <input type="number" min="1" value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-center font-display text-lg font-extrabold"/>
              <button onClick={() => setQuantity((v) => v + (product.category === 'print' ? 25 : 1))} className="grid h-12 w-12 place-items-center rounded-xl border border-ink-200 bg-white text-ink-800"><Plus size={18}/></button>
            </div>
          </Field>
        </div>

        <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-ink-900 p-4 text-white">
          <div>
            <p className="text-xs text-ink-300">{quantity} {product.unit}{quantity > 1 ? 's' : ''}</p>
            <p className="font-display text-2xl font-extrabold">{INR(total)}</p>
          </div>
          <button onClick={() => onAdd({ productId: product.id, productName: product.name, shopId: listing?.shops?.id, shopName: listing?.shops?.name, listingId: listing?.id, quantity, unitPrice, configuration: { material: product.materials?.[matIdx]?.label, sides, gift: product.gift_options?.[giftIdx]?.name, photoName } })}
            disabled={!listing} className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-5 py-3 text-sm font-extrabold text-white transition hover:bg-brand-400 disabled:cursor-not-allowed disabled:opacity-50">
            Add to cart <ArrowRight size={17}/>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Field({ label, children }) {
  return <label className="block"><span className="mb-2 block text-xs font-bold uppercase tracking-wider text-ink-500">{label}</span>{children}</label>;
}

function CartDrawer({ cart, total, onClose, onRemove, onLogin, session }) {
  return (
    <motion.div className="fixed inset-0 z-50 flex justify-end bg-ink-900/40 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.aside className="flex h-full w-full max-w-md flex-col bg-ink-50 p-5 shadow-2xl sm:p-7" initial={{ x: 40 }} animate={{ x: 0 }} exit={{ x: 40 }}>
        <div className="flex items-center justify-between">
          <div><p className="text-xs font-bold uppercase tracking-[.14em] text-brand-700">Your basket</p><h2 className="font-display text-2xl font-extrabold">Ready when you are</h2></div>
          <button onClick={onClose} className="grid h-10 w-10 place-items-center rounded-xl bg-white text-ink-700"><X size={19}/></button>
        </div>
        {cart.length ? (
          <>
            <div className="mt-7 flex-1 space-y-3 overflow-y-auto">
              {cart.map((item, i) => (
                <div key={`${item.productId}-${i}`} className="rounded-2xl border border-ink-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-sm font-extrabold">{item.productName}</p>
                      <p className="mt-1 text-xs text-ink-500">{item.quantity} {item.quantity > 1 ? 'units' : 'unit'} · {item.shopName}</p>
                      <p className="mt-2 text-xs text-ink-700">{Object.values(item.configuration ?? {}).filter(Boolean).join(' · ')}</p>
                    </div>
                    <p className="font-display font-extrabold text-brand-700">{INR(item.unitPrice * item.quantity)}</p>
                  </div>
                  <button onClick={() => onRemove(i)} className="mt-3 text-xs font-bold text-red-700">Remove</button>
                </div>
              ))}
            </div>
            <div className="border-t border-ink-200 pt-5">
              <div className="flex items-center justify-between"><span className="text-sm font-semibold text-ink-500">Subtotal</span><span className="font-display text-2xl font-extrabold">{INR(total)}</span></div>
              <button onClick={session ? undefined : onLogin} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3.5 text-sm font-extrabold text-white transition hover:bg-brand-800">{session ? 'Continue to checkout' : 'Sign in to checkout'} <ArrowRight size={17}/></button>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <ShoppingBag size={42} className="text-ink-300"/>
            <h3 className="mt-4 font-display text-lg font-extrabold">Your basket is empty</h3>
            <p className="mt-1 max-w-xs text-sm text-ink-500">Pick something from the local shelf and we'll keep it here while you browse.</p>
          </div>
        )}
      </motion.aside>
    </motion.div>
  );
}

function LoginPage({ onBack }) {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  async function sendOtp(e) {
    e.preventDefault(); setBusy(true); setErr('');
    const { error } = await supabase.auth.signInWithOtp({ phone });
    setBusy(false);
    if (error) setErr('We could not send that code. Check the number and try again.');
    else { setSent(true); setMsg('Your verification code is on its way.'); }
  }
  async function verify(e) {
    e.preventDefault(); setBusy(true); setErr('');
    const { data, error } = await supabase.auth.verifyOtp({ phone, token: otp, type: 'sms' });
    if (error) { setErr('That code is invalid or expired. Request a new one.'); setBusy(false); return; }
    if (data.user) await supabase.from('profiles').upsert({ id: data.user.id, phone, full_name: '' }, { onConflict: 'id', ignoreDuplicates: true });
    setBusy(false); onBack();
  }

  return (
    <div className="min-h-screen bg-brand-50">
      <header className="border-b border-brand-100 bg-white/70">
        <div className="mx-auto flex h-[72px] max-w-7xl items-center px-4 sm:px-6 lg:px-8">
          <button onClick={onBack} className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-700 font-display text-sm font-extrabold text-white">pz</span>
            <span className="font-display text-lg font-extrabold">printez</span>
          </button>
        </div>
      </header>
      <main className="mx-auto flex min-h-[calc(100vh-72px)] max-w-6xl items-center justify-center px-4 py-10 sm:px-6">
        <div className="grid w-full max-w-4xl overflow-hidden rounded-[28px] border border-brand-100 bg-white shadow-[0_24px_80px_-35px_rgba(124,45,18,.35)] md:grid-cols-2">
          <div className="hidden bg-brand-800 p-10 text-white md:block">
            <Sparkles size={28} className="text-brand-300"/>
            <h1 className="mt-20 font-display text-4xl font-extrabold leading-tight">Your local print run starts here.</h1>
            <p className="mt-5 text-brand-100">One account for your saved details, live order tracking, and every idea you bring to life.</p>
          </div>
          <div className="p-6 sm:p-10">
            <p className="text-sm font-bold text-brand-700">Welcome to printez</p>
            <h1 className="mt-2 font-display text-3xl font-extrabold tracking-tight">Sign in with your phone</h1>
            <p className="mt-3 text-sm leading-6 text-ink-500">We'll send you a one-time verification code. No password to remember.</p>
            {msg && <div className="mt-5 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">{msg}</div>}
            {err && <div className="mt-5 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">{err}</div>}
            <form onSubmit={sent ? verify : sendOtp} className="mt-7 space-y-4">
              <Field label="Mobile number">
                <input required type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 90000 00001" disabled={sent} className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-semibold text-ink-900 outline-none focus:border-brand-500"/>
              </Field>
              {sent && <Field label="Verification code">
                <input required type="text" inputMode="numeric" maxLength="6" value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))} placeholder="6-digit code" className="w-full rounded-xl border border-ink-200 bg-white px-4 py-3 text-sm font-semibold tracking-[.3em] outline-none focus:border-brand-500"/>
              </Field>}
              <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-brand-700 px-4 py-3.5 text-sm font-extrabold text-white transition hover:bg-brand-800 disabled:opacity-60">{busy ? 'Please wait...' : sent ? 'Verify and continue' : 'Send verification code'} <ArrowRight size={17}/></button>
            </form>
            {sent && <button onClick={() => { setSent(false); setOtp(''); setMsg(''); }} className="mt-4 w-full text-center text-xs font-bold text-ink-500 hover:text-brand-700">Use a different number</button>}
          </div>
        </div>
      </main>
    </div>
  );
}

function OrdersPage({ session, onBack, onLogin }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    (async () => {
      const { data, error } = await supabase.from('orders')
        .select('id,status,total_paise,delivery_method,created_at,shops(name,sector),order_items(product_id,quantity,configuration,products(name)),order_timeline(status,note,created_at)')
        .order('created_at', { ascending: false });
      if (error) setError('We could not load your orders right now.');
      else setOrders(data ?? []);
      setLoading(false);
    })();
  }, [session]);

  if (!session) return (
    <div className="min-h-screen bg-ink-50">
      <Header session={session} cartCount={0} onLogin={onLogin} onHome={onBack} onOrders={() => {}}/>
      <main className="mx-auto max-w-xl px-4 py-20 text-center">
        <ShoppingBag className="mx-auto text-ink-300" size={42}/>
        <h1 className="mt-5 font-display text-3xl font-extrabold">Your orders live here</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-ink-500">Sign in to see your order progress, shop details, and past purchases.</p>
        <button onClick={onLogin} className="mt-6 rounded-xl bg-brand-700 px-5 py-3 text-sm font-extrabold text-white">Sign in to view orders</button>
      </main>
    </div>
  );

  return (
    <div className="min-h-screen bg-ink-50 pb-20">
      <Header session={session} cartCount={0} onLogin={onLogin} onHome={onBack} onOrders={() => {}}/>
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <button onClick={onBack} className="text-sm font-bold text-brand-700">← Back to shop</button>
        <div className="mt-5">
          <p className="text-sm font-bold text-brand-700">Your printez activity</p>
          <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">Orders</h1>
          <p className="mt-2 text-sm text-ink-500">Keep an eye on every idea from placed to delivered.</p>
        </div>
        {error && <div className="mt-6 rounded-2xl bg-red-50 p-4 text-sm font-semibold text-red-800">{error}</div>}
        {loading ? <div className="mt-8 space-y-3">{[1,2,3].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-white"/>)}</div>
        : orders.length ? <div className="mt-8 space-y-4">{orders.map((o) => <OrderCard key={o.id} order={o}/>)}</div>
        : <div className="mt-8 rounded-3xl border border-dashed border-ink-300 bg-white p-12 text-center">
            <ShoppingBag className="mx-auto text-ink-300" size={38}/>
            <h2 className="mt-4 font-display text-xl font-extrabold">No orders yet</h2>
            <p className="mt-2 text-sm text-ink-500">Your next local print run will appear here.</p>
            <button onClick={onBack} className="mt-5 rounded-xl bg-brand-700 px-4 py-3 text-sm font-extrabold text-white">Browse the catalog</button>
          </div>}
      </main>
    </div>
  );
}

function OrderCard({ order }) {
  const timeline = order.order_timeline ?? [];
  const currentIdx = STATUS_FLOW.indexOf(order.status);
  const item = order.order_items?.[0];
  return (
    <article className="rounded-2xl border border-ink-200 bg-white p-5 card-shadow">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wider text-ink-500">Order {order.id.slice(0,8).toUpperCase()}</p>
          <h2 className="mt-1 font-display text-lg font-extrabold">{item?.products?.name ?? 'Custom order'}</h2>
          <p className="mt-1 text-sm text-ink-500">{order.shops?.name ?? 'Finding a nearby shop'} · {item?.quantity ?? 1} unit{item?.quantity === 1 ? '' : 's'}</p>
        </div>
        <div className="text-right">
          <p className="font-display text-xl font-extrabold text-brand-700">{INR(order.total_paise)}</p>
          <p className="mt-1 text-xs font-semibold capitalize text-ink-500">{order.delivery_method}</p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-6 gap-1">
        {STATUS_FLOW.map((s, i) => (
          <div key={s} className="text-center">
            <div className={`mx-auto grid h-7 w-7 place-items-center rounded-full text-xs font-extrabold ${i <= currentIdx ? 'bg-brand-700 text-white' : 'bg-ink-100 text-ink-500'}`}>{i < currentIdx ? <Check size={14}/> : i + 1}</div>
            <p className="mt-2 hidden text-[10px] font-bold leading-3 text-ink-500 sm:block">{s.replaceAll('_',' ')}</p>
          </div>
        ))}
      </div>
      {timeline.length > 0 && (
        <div className="mt-5 border-t border-ink-100 pt-4">
          {timeline.slice().sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] && (
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-700">
              <Clock3 size={15} className="text-brand-600"/>
              {timeline[0].note || timeline[0].status.replaceAll('_',' ')}
              <span className="ml-auto text-xs font-normal text-ink-500">{new Date(timeline[0].created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

function MobileNav({ cartCount, onCart, onLogin, onOrders }) {
  useEffect(() => {
    const h = () => onCart();
    window.addEventListener('open-cart', h);
    return () => window.removeEventListener('open-cart', h);
  }, [onCart]);
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t border-ink-200 bg-white/95 px-4 py-2.5 backdrop-blur-xl sm:hidden">
      <div className="mx-auto flex max-w-md items-center justify-around">
        <button className="flex flex-col items-center gap-1 text-brand-700"><ShoppingBag size={20}/><span className="text-[11px] font-bold">Shop</span></button>
        <button onClick={onCart} className="relative flex flex-col items-center gap-1 text-ink-500"><ShoppingBag size={20}/><span className="text-[11px] font-bold">Cart</span>{cartCount > 0 && <span className="absolute -right-2 -top-2 rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white">{cartCount}</span>}</button>
        <button onClick={onOrders} className="flex flex-col items-center gap-1 text-ink-500"><Clock3 size={20}/><span className="text-[11px] font-bold">Orders</span></button>
        <button onClick={onLogin} className="flex flex-col items-center gap-1 text-ink-500"><CircleUserRound size={20}/><span className="text-[11px] font-bold">Account</span></button>
      </div>
    </nav>
  );
}

function LoadingGrid() {
  return <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-5">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="overflow-hidden rounded-2xl border border-ink-200 bg-white"><div className="aspect-square animate-pulse bg-ink-100"/><div className="space-y-3 p-4"><div className="h-4 animate-pulse rounded bg-ink-100"/><div className="h-3 w-2/3 animate-pulse rounded bg-ink-100"/><div className="h-6 w-1/2 animate-pulse rounded bg-ink-100"/></div></div>)}</div>;
}

function EmptyState() {
  return <div className="mt-10 rounded-3xl border border-dashed border-ink-300 bg-white p-12 text-center"><ShoppingBag className="mx-auto text-ink-300" size={38}/><h3 className="mt-4 font-display text-xl font-extrabold">Nothing matches that search</h3><p className="mt-2 text-sm text-ink-500">Try another product or switch back to Everything.</p></div>;
}

export { App };
