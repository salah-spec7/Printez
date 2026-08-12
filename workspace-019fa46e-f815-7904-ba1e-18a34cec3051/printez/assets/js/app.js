/* ========== printez data layer (localStorage-backed mock backend) ==========
   Persists data in localStorage so all three portals read/write the same state.
   Swap DB.* calls for real fetch() endpoints when moving to production.
=========================================================================== */

const DB_KEYS = {
  shops: 'pz_shops_v1',
  products: 'pz_products_v1',
  orders: 'pz_orders_v1',
  session_customer: 'pz_sess_cust_v1',
  session_seller: 'pz_sess_sell_v1',
  session_admin: 'pz_sess_adm_v1',
  cart: 'pz_cart_v1',
  seeded: 'pz_seeded_v7',
};

const inr = (n)=> '₹' + Math.round(n).toLocaleString('en-IN');

const STATUS_FLOW = ['placed','assigned','in_production','ready','out_for_delivery','delivered'];
const STATUS_LABEL = {
  placed:'Placed', assigned:'Assigned to Shop', in_production:'In Production',
  ready:'Ready', out_for_delivery:'Out for Delivery', delivered:'Delivered'
};
const STATUS_BADGE = {
  placed:'badge-placed', assigned:'badge-assigned', in_production:'badge-in_production',
  ready:'badge-ready', out_for_delivery:'badge-out_for_delivery', delivered:'badge-delivered'
};
const COMMISSION = { print: 0.15, gifting: 0.25 }; // platform fee

const uid = (p='id')=> p + '_' + Math.random().toString(36).slice(2,9) + Date.now().toString(36).slice(-3);
const now = ()=> new Date().toISOString();
const fmtDate = (iso)=>{
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})+' · '+d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'});
};
const fmtDateShort = (iso)=> new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short'});
const daysAgo = (n)=> new Date(Date.now()-n*86400000).toISOString();
const hoursAgo = (n)=> new Date(Date.now()-n*3600000).toISOString();

/* ---- read/write primitives ---- */
const DB = {
  get(key, fallback){
    try { const v = localStorage.getItem(key); return v?JSON.parse(v):fallback; }
    catch(e){ return fallback; }
  },
  set(key, val){ localStorage.setItem(key, JSON.stringify(val)); },
};

/* ---- seed ---- */
function seedIfNeeded(){
  if(DB.get(DB_KEYS.seeded)) return;

  const shops = [
    { id:'shop_1', name:'Shree Sai Printers', ownerName:'Rajesh Patil', phone:'9820011223', email:'rajesh@shreesai.example', address:'Shop 12, Sector 12, Kharghar, Navi Mumbai 410210', categories:['print'], status:'approved', avgRating:4.6, createdAt:daysAgo(220), listings:[] },
    { id:'shop_2', name:'Kharghar Gift Gallery', ownerName:'Meera Joshi', phone:'9820144556', email:'meera@kgg.example', address:'Plot 4, Utsav Chowk, Kharghar', categories:['gifting'], status:'approved', avgRating:4.2, createdAt:daysAgo(180), listings:[] },
    { id:'shop_3', name:'NaviMug Creations', ownerName:'Priya Shinde', phone:'9820333445', email:'priya@navimug.example', address:'Sector 10, Kharghar', categories:['gifting'], status:'approved', avgRating:3.2, createdAt:daysAgo(90), listings:[] },
    // two pending signups
    { id:'shop_p1', name:'Om Digital Prints', ownerName:'Suresh Kumar', phone:'9820277889', email:'suresh@omdigital.example', address:'Shop 3, Shilp Chowk, Sector 20, Kharghar', categories:['print','gifting'], status:'pending', avgRating:null, createdAt:daysAgo(3), listings:[] },
    { id:'shop_p2', name:'Bright Arts Studio', ownerName:'Amit Desai', phone:'9820499110', email:'amit@brightarts.example', address:'Near Hiranandani Palace, Kharghar', categories:['print','gifting'], status:'pending', avgRating:null, createdAt:daysAgo(1), listings:[] },
  ];

  // Seed catalog: platform-curated products with shop-specific listings (price/quantity)
  const products = [
    // PRINT
    mkProductTemplate('visiting_cards','Visiting Cards','print','pc','Premium matte & gloss finishes',[
      {label:'Standard Matte', mult:1.0},{label:'Premium Gloss', mult:1.25},{label:'Textured', mult:1.6},{label:'Recycled', mult:1.4}
    ], {hasSides:true, customSize:false, sizes:['89×54 mm (Standard)','90×54 mm (US)'], basePrice:7, tiers:[[25,7],[50,5],[100,3.5],[500,2.5],[1000,1.5]], unit:'pc'}),
    mkProductTemplate('stickers','Stickers','print','sticker','Vinyl, paper & holographic',[
      {label:'Paper',mult:1},{label:'Vinyl Matte',mult:1.2},{label:'Vinyl Gloss',mult:1.3},{label:'Holographic',mult:2.0}
    ], {hasSides:false, customSize:true, sizes:[], basePrice:35, tiers:[[25,35],[50,28],[100,24],[500,20],[1000,18]], unit:'pc'}),
    mkProductTemplate('banners','Banner Printing','print','banner','Flex, sunboard & fabric',[
      {label:'Flex (Standard)',mult:1},{label:'Flex (Premium)',mult:1.2},{label:'Sunboard 3mm',mult:1.8},{label:'Sunboard 5mm',mult:2.3},{label:'Fabric',mult:2.2}
    ], {hasSides:false, customSize:true, sizes:[], basePrice:20, tiers:[[10,20],[25,16],[50,14],[100,12]], unit:'sq.ft'}),
    mkProductTemplate('flyers','Flyers & Brochures','print','flyer','A4/A5 full color',[
      {label:'130gsm Gloss',mult:1},{label:'170gsm Matte',mult:1.15},{label:'250gsm Card',mult:1.5}
    ], {hasSides:true, customSize:false, sizes:['A6','A5','A4'], basePrice:8, tiers:[[50,8],[100,5],[250,3.5],[500,2.5],[1000,1.8]], unit:'pc'}),
    // GIFTING
    mkProductTemplate('mug','Personalized Mug','gifting','mug','Ceramic, photo-printed',[],{gifting:true, unit:'pc', giftOpts:[{name:'White Ceramic',price:299},{name:'Black Magic Mug',price:449},{name:'Inside-Color Mug',price:399}]}),
    mkProductTemplate('frame','Photo Frame','gifting','frame','Wooden & acrylic finishes',[],{gifting:true, unit:'pc', giftOpts:[{name:'4×6"',price:399},{name:'5×7"',price:499},{name:'8×10"',price:799},{name:'A4 Collage',price:999}]}),
    mkProductTemplate('greeting','Custom Greeting Card','gifting','greet','Folded, with envelope',[],{gifting:true, unit:'pc', giftOpts:[{name:'Single card',price:99},{name:'Pack of 5',price:399,qty:5},{name:'Pack of 10',price:699,qty:10}]}),
    mkProductTemplate('tshirt','Custom T-Shirt','gifting','tee','Cotton, DTF print',[],{gifting:true, unit:'pc', giftOpts:[{name:'White Tee',price:499},{name:'Black Tee',price:549},{name:'Oversized Tee',price:699}]}),
  ];

  // Shop listings: each approved shop sells products at or near the platform's "from" prices,
  // with small variances (NaviMug is marked as low-quality so they charge a small premium).
  addListing(shops, products, 'shop_1', 'visiting_cards', {baseAdj:0});
  addListing(shops, products, 'shop_1', 'stickers', {baseAdj:0});
  addListing(shops, products, 'shop_1', 'banners', {baseAdj:0});
  addListing(shops, products, 'shop_1', 'flyers', {baseAdj:0});

  addListing(shops, products, 'shop_2', 'frame', {baseAdj:0});
  addListing(shops, products, 'shop_2', 'greeting', {baseAdj:0});
  addListing(shops, products, 'shop_2', 'mug', {baseAdj:0});

  addListing(shops, products, 'shop_3', 'mug', {baseAdj:0});
  addListing(shops, products, 'shop_3', 'tshirt', {baseAdj:0});
  addListing(shops, products, 'shop_3', 'frame', {baseAdj:50}); // slightly more expensive, lower ratings

  // Sample orders
  const orders = [];
  const addOrder = (o)=> orders.push(Object.assign({
    id:'ORD-'+(1000+orders.length+1), customerName:'', customerPhone:'', customerId:null,
    productId:'', listingId:'', shopId:null, specs:{}, quantity:1,
    unitPrice:0, totalAmount:0, commissionAmount:0, shopPayoutAmount:0,
    status:'placed', rating:null, review:'',
    address:'', delivery:'delivery',
    timeline:[{status:'placed', at:now()}],
    createdAt:now()
  }, o));

  // Demo customer Ananya Rao (phone 9000000001) has a rich order history spanning every status
  // so reviewers see a full timeline when they use the demo quick-login.
  const ANANYA = '9000000001';
  addOrder({customerName:'Ananya R.', customerPhone:ANANYA, productId:'visiting_cards', shopId:'shop_1', specs:{material:'Premium Gloss',sides:'double',size:'89×54 mm (Standard)'}, quantity:500, unitPrice:2.5, totalAmount:1250, commissionAmount:188, shopPayoutAmount:1062, status:'delivered', rating:5, review:'Great quality, delivered on time!', address:'B-402, Jalvayu Towers, Sector 20, Kharghar', timeline:[{status:'placed',at:daysAgo(14)},{status:'assigned',at:daysAgo(14)},{status:'in_production',at:daysAgo(13)},{status:'ready',at:daysAgo(12)},{status:'out_for_delivery',at:daysAgo(12)},{status:'delivered',at:daysAgo(12)}], createdAt:daysAgo(14)});
  addOrder({customerName:'Ananya R.', customerPhone:ANANYA, productId:'flyers', shopId:'shop_1', specs:{material:'170gsm Matte',sides:'double',size:'A5'}, quantity:250, unitPrice:3.5, totalAmount:875, commissionAmount:131, shopPayoutAmount:744, status:'out_for_delivery', address:'B-402, Jalvayu Towers, Sector 20, Kharghar', timeline:[{status:'placed',at:daysAgo(2)},{status:'assigned',at:daysAgo(2)},{status:'in_production',at:daysAgo(1)},{status:'ready',at:hoursAgo(8)},{status:'out_for_delivery',at:hoursAgo(1)}], createdAt:daysAgo(2)});
  addOrder({customerName:'Ananya R.', customerPhone:ANANYA, productId:'mug', shopId:'shop_2', specs:{option:'Inside-Color Mug (₹399)'}, quantity:1, unitPrice:399, totalAmount:399, commissionAmount:100, shopPayoutAmount:299, status:'ready', address:'B-402, Jalvayu Towers, Sector 20, Kharghar', timeline:[{status:'placed',at:hoursAgo(20)},{status:'assigned',at:hoursAgo(19)},{status:'in_production',at:hoursAgo(10)},{status:'ready',at:hoursAgo(2)}], createdAt:hoursAgo(20)});
  addOrder({customerName:'Ananya R.', customerPhone:ANANYA, productId:'stickers', shopId:'shop_1', specs:{material:'Vinyl Matte',size:'2×2 in'}, quantity:200, unitPrice:24, totalAmount:4800, commissionAmount:720, shopPayoutAmount:4080, status:'in_production', address:'B-402, Jalvayu Towers, Sector 20, Kharghar', timeline:[{status:'placed',at:hoursAgo(9)},{status:'assigned',at:hoursAgo(8)},{status:'in_production',at:hoursAgo(3)}], createdAt:hoursAgo(9)});
  addOrder({customerName:'Ananya R.', customerPhone:ANANYA, productId:'greeting', shopId:'shop_2', specs:{option:'Pack of 5 (₹399)'}, quantity:1, unitPrice:399, totalAmount:399, commissionAmount:100, shopPayoutAmount:299, status:'assigned', address:'B-402, Jalvayu Towers, Sector 20, Kharghar', timeline:[{status:'placed',at:hoursAgo(4)},{status:'assigned',at:hoursAgo(3)}], createdAt:hoursAgo(4)});
  addOrder({customerName:'Ananya R.', customerPhone:ANANYA, productId:'tshirt', shopId:null, specs:{option:'White Tee (₹499)'}, quantity:2, unitPrice:499, totalAmount:998, commissionAmount:250, shopPayoutAmount:748, status:'placed', address:'B-402, Jalvayu Towers, Sector 20, Kharghar', timeline:[{status:'placed',at:hoursAgo(1)}], createdAt:hoursAgo(1)});
  // Other shoppers' orders give sellers/admins more volume to look at
  addOrder({customerName:'Vikram M.', customerPhone:'9000000002', productId:'stickers', shopId:'shop_1', specs:{material:'Vinyl Matte',size:'3×3 in'}, quantity:100, unitPrice:24, totalAmount:2400, commissionAmount:360, shopPayoutAmount:2040, status:'delivered', rating:4, address:'Shop 8, Prime Mall, Sector 12, Kharghar', timeline:[{status:'placed',at:daysAgo(6)},{status:'assigned',at:daysAgo(6)},{status:'in_production',at:daysAgo(5)},{status:'ready',at:daysAgo(5)},{status:'out_for_delivery',at:daysAgo(4)},{status:'delivered',at:daysAgo(4)}], createdAt:daysAgo(6)});
  addOrder({customerName:'Sneha K.', customerPhone:'9000000003', productId:'mug', shopId:'shop_2', specs:{option:'Black Magic Mug (₹449)'}, quantity:2, unitPrice:449, totalAmount:898, commissionAmount:225, shopPayoutAmount:673, status:'delivered', rating:5, review:'Loved the magic mug!', address:'C-11, Nisarg Hyde Park, Sector 35E, Kharghar', timeline:[{status:'placed',at:daysAgo(9)},{status:'assigned',at:daysAgo(9)},{status:'in_production',at:daysAgo(8)},{status:'ready',at:daysAgo(8)},{status:'out_for_delivery',at:daysAgo(7)},{status:'delivered',at:daysAgo(7)}], createdAt:daysAgo(9)});
  addOrder({customerName:'Rahul D.', customerPhone:'9000000004', productId:'banners', shopId:'shop_1', specs:{material:'Sunboard 5mm',size:'8×6 ft (48 sq.ft)'}, quantity:48, unitPrice:14, totalAmount:672, commissionAmount:101, shopPayoutAmount:571, status:'delivered', rating:4, address:'Good Year Bakery, Sector 7, Kharghar', timeline:[{status:'placed',at:daysAgo(11)},{status:'assigned',at:daysAgo(11)},{status:'in_production',at:daysAgo(10)},{status:'ready',at:daysAgo(10)},{status:'out_for_delivery',at:daysAgo(9)},{status:'delivered',at:daysAgo(9)}], createdAt:daysAgo(11)});
  addOrder({customerName:'Priya S.', customerPhone:'9000000005', productId:'frame', shopId:'shop_3', specs:{option:'8×10" (₹799)'}, quantity:1, unitPrice:799, totalAmount:799, commissionAmount:200, shopPayoutAmount:599, status:'delivered', rating:2, review:'Frame arrived a bit scratched.', address:'A-504, Regency Gardens, Sector 6, Kharghar', timeline:[{status:'placed',at:daysAgo(7)},{status:'assigned',at:daysAgo(7)},{status:'in_production',at:daysAgo(6)},{status:'ready',at:daysAgo(6)},{status:'out_for_delivery',at:daysAgo(5)},{status:'delivered',at:daysAgo(5)}], createdAt:daysAgo(7)});
  addOrder({customerName:'Kavya P.', customerPhone:'9000000007', productId:'greeting', shopId:null, specs:{option:'Pack of 10 (₹699)'}, quantity:1, unitPrice:699, totalAmount:699, commissionAmount:175, shopPayoutAmount:524, status:'placed', address:'D-22, Bhoomi Gardenia, Roadpali, Kalamboli', timeline:[{status:'placed',at:hoursAgo(2)}], createdAt:hoursAgo(2)});
  addOrder({customerName:'Ishaan B.', customerPhone:'9000000008', productId:'banners', shopId:null, specs:{material:'Flex (Standard)',size:'10×4 ft (40 sq.ft)'}, quantity:40, unitPrice:20, totalAmount:800, commissionAmount:120, shopPayoutAmount:680, status:'placed', address:'1404, Paradise Sai Crystals, Sector 35D, Kharghar', timeline:[{status:'placed',at:hoursAgo(5)}], createdAt:hoursAgo(5)});
  addOrder({customerName:'Neha G.', customerPhone:'9000000009', productId:'mug', shopId:'shop_3', specs:{option:'White Ceramic (₹299)'}, quantity:1, unitPrice:299, totalAmount:299, commissionAmount:75, shopPayoutAmount:224, status:'delivered', rating:2, review:'Print was blurry.', address:'E-702, Greenwoods, Sector 45, Kharghar', timeline:[{status:'placed',at:daysAgo(10)},{status:'assigned',at:daysAgo(10)},{status:'in_production',at:daysAgo(9)},{status:'ready',at:daysAgo(9)},{status:'out_for_delivery',at:daysAgo(8)},{status:'delivered',at:daysAgo(8)}], createdAt:daysAgo(10)});

  DB.set(DB_KEYS.shops, shops);
  DB.set(DB_KEYS.products, products);
  DB.set(DB_KEYS.orders, orders);
  DB.set(DB_KEYS.seeded, true);
}
function mkProductTemplate(id,name,category,art,tagline,materials,opts){
  return { id, name, category, art, tagline, materials, ...opts, platformOwned:true };
}
function addListing(shops, products, shopId, productId, overrides={}){
  const shop = shops.find(s=>s.id===shopId);
  const prod = products.find(p=>p.id===productId);
  if(!shop||!prod) return;
  const listingId = uid('lst');
  const baseAdj = overrides.baseAdj||0;
  const listing = {
    id:listingId, shopId, productId,
    active:true, leadTimeHours: prod.category==='print'?6:24,
    deliveryFee: (shopId==='shop_3')?59:39,
    tierOverrides:null,
    baseAdj,
  };
  if(!shop.listings) shop.listings=[];
  shop.listings.push(listingId);
  prod.listings = prod.listings||[];
  prod.listings.push(listingId);
  // persist listing id -> listing mapping in products._listingMap
  prod._listingMap = prod._listingMap||{};
  prod._listingMap[listingId] = listing;
}

/* ---- public accessors ---- */
const Data = {
  shops: ()=> DB.get(DB_KEYS.shops, []),
  saveShops: (s)=> DB.set(DB_KEYS.shops, s),
  products: ()=> DB.get(DB_KEYS.products, []),
  saveProducts: (p)=> DB.set(DB_KEYS.products, p),
  orders: ()=> DB.get(DB_KEYS.orders, []),
  saveOrders: (o)=> DB.set(DB_KEYS.orders, o),
  cart: ()=> DB.get(DB_KEYS.cart, []),
  saveCart: (c)=> DB.set(DB_KEYS.cart, c),

  productById(id){ return this.products().find(p=>p.id===id); },
  shopById(id){ return this.shops().find(s=>s.id===id); },
  orderById(id){ return this.orders().find(o=>o.id===id); },

  listingById(productId, listingId){
    const p = this.productById(productId); if(!p) return null;
    return (p._listingMap||{})[listingId] || null;
  },
  shopListings(shopId){
    const p = this.products();
    const out=[];
    p.forEach(prod=>{
      Object.values(prod._listingMap||{}).forEach(l=>{
        if(l.shopId===shopId) out.push({product:prod, listing:l});
      });
    });
    return out;
  },
  activeListingsForProduct(productId){
    const p = this.productById(productId); if(!p) return [];
    return Object.values(p._listingMap||{}).filter(l=>{
      const sh = this.shopById(l.shopId);
      return l.active && sh && sh.status==='approved';
    });
  },
  cheapestListing(productId){
    const ls = this.activeListingsForProduct(productId);
    if(!ls.length) return null;
    const p = this.productById(productId);
    return ls.map(l=>({l, price:computeStartingPrice(p,l)}))
      .sort((a,b)=>a.price-b.price)[0];
  },
  recomputeShopRating(shopId){
    const os = this.orders().filter(o=>o.shopId===shopId && o.rating!=null);
    const sh = this.shopById(shopId);
    if(!sh) return;
    sh.avgRating = os.length? os.reduce((s,o)=>s+o.rating,0)/os.length : null;
    this.saveShops(this.shops());
  },
  eligibleShops(productId){
    return this.shops().filter(s=>{
      if(s.status!=='approved') return false;
      const listings = this.shopListings(s.id).filter(x=>x.product.id===productId && x.listing.active);
      return listings.length>0;
    });
  },
  autoAssignOrder(order){
    // Pick the cheapest eligible shop that has capacity (<5 active orders)
    const p = this.productById(order.productId);
    if(!p) return null;
    const orders = this.orders();
    const withLoad = this.eligibleShops(order.productId).map(s=>{
      const active = orders.filter(o=>o.shopId===s.id && ['assigned','in_production','ready','out_for_delivery'].includes(o.status)).length;
      const listings = this.shopListings(s.id).filter(x=>x.product.id===order.productId && x.listing.active);
      const l = listings[0];
      const price = computeStartingPrice(p,l.listing);
      return {shop:s, listing:l, active, price};
    });
    withLoad.sort((a,b)=>{
      // Prefer <5 active, then rating, then price
      const aCap = a.active>=5?1:0, bCap=b.active>=5?1:0;
      if(aCap!==bCap) return aCap-bCap;
      const aR = a.shop.avgRating||0, bR=b.shop.avgRating||0;
      if(Math.abs(aR-bR)>0.3) return bR-aR;
      return a.price-b.price;
    });
    const chosen = withLoad[0];
    if(!chosen) return null;
    order.shopId = chosen.shop.id;
    order.listingId = chosen.listing.listing.id;
    return chosen;
  }
};

/* ---- pricing ---- */
function tierPrice(product, qty){
  if(!product.tiers) return product.basePrice;
  let price = product.basePrice;
  for(const [t,p] of product.tiers) if(qty>=t) price=p;
  return price;
}
function computeStartingPrice(product, listing){
  const baseAdj = listing.baseAdj||0;
  if(product.gifting){
    return Math.min(...product.giftOpts.map(g=>g.price)) + baseAdj;
  }
  // "From" shows the lowest possible unit price (largest bulk tier), per product spec.
  // The card also shows the minimum order qty to get that price.
  return product.tiers[product.tiers.length-1][1] + baseAdj;
}
function startingPriceTierQty(product){
  if(product.gifting) return 1;
  return product.tiers[product.tiers.length-1][0];
}
function calcPrice(product, listing, opts){
  const baseAdj = listing.baseAdj||0;
  if(product.gifting){
    const g = product.giftOpts[opts.giftIdx||0];
    const q = opts.quantity||1;
    return { unitPrice:g.price+baseAdj, quantity:q, area:1, total:(g.price+baseAdj)*q };
  }
  const q = Math.max(1, parseInt(opts.quantity)||1);
  let unit = tierPrice(product,q) + baseAdj;
  // material multiplier (based on index)
  const mult = [1,1.25,1.6,1.8,2.0];
  unit *= mult[opts.materialIdx||0];
  if(product.hasSides && opts.sides==='double') unit *= 1.7;
  let area = 1;
  if(product.customSize){
    if(product.id==='banners'){
      const w=Math.max(.5,parseFloat(opts.width)||1), h=Math.max(.5,parseFloat(opts.height)||1);
      area=Math.max(1,w*h);
    } else if(product.id==='stickers'){
      const w=Math.max(.5,parseFloat(opts.width)||2), h=Math.max(.5,parseFloat(opts.height)||2);
      area=Math.max(.5,(w*h)/9);
    }
  }
  const unitPrice = unit*area;
  return { unitPrice, quantity:q, area, total:unitPrice*q };
}

/* ---- auth ---- */
const Auth = {
  customer(){ return DB.get(DB_KEYS.session_customer, null); },
  setCustomer(c){ DB.set(DB_KEYS.session_customer, c); },
  clearCustomer(){ localStorage.removeItem(DB_KEYS.session_customer); },

  seller(){ return DB.get(DB_KEYS.session_seller, null); },
  setSeller(s){ DB.set(DB_KEYS.session_seller, s); },
  clearSeller(){ localStorage.removeItem(DB_KEYS.session_seller); },

  admin(){ return DB.get(DB_KEYS.session_admin, null); },
  setAdmin(a){ DB.set(DB_KEYS.session_admin, a); },
  clearAdmin(){ localStorage.removeItem(DB_KEYS.session_admin); },
};

/* ---- Toasts ---- */
function toast(msg, kind='info'){
  let root = document.getElementById('toasts');
  if(!root){ root = document.createElement('div'); root.id='toasts'; root.className='toasts'; document.body.appendChild(root); }
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const icon = kind==='success'?'✓':kind==='error'?'✕':'ⓘ';
  el.innerHTML = `<span class="ic">${icon}</span><span>${msg}</span>`;
  root.appendChild(el);
  setTimeout(()=>{ el.style.transition='opacity .3s'; el.style.opacity=0; setTimeout(()=>el.remove(),300); },2600);
}

function showModal(html, onMount){
  const bd = document.createElement('div');
  bd.className='modal-backdrop';
  bd.innerHTML = `<div class="modal" onclick="event.stopPropagation()">${html}</div>`;
  document.body.appendChild(bd);
  bd.addEventListener('click', ()=>bd.remove());
  if(onMount) onMount(bd);
  return bd;
}
function closeModal(el){ el && el.remove(); }

/* ---- product SVG art (shared) ---- */
function productArt(p, size=200){
  const palettes = { print:['#fff7ed','#fed7aa','#c2410c'], gifting:['#fff1f2','#fecdd3','#be123c'] };
  const [bg,mid,fg] = palettes[p.category];
  const cx=size/2, cy=size/2;
  let art='';
  switch(p.art){
    case 'pc':
      art=`<rect x="${cx-55}" y="${cy-35}" width="110" height="70" rx="6" fill="white" stroke="${fg}" stroke-width="2"/>
           <rect x="${cx-45}" y="${cy-23}" width="50" height="5" rx="2" fill="${mid}"/>
           <rect x="${cx-45}" y="${cy-12}" width="80" height="4" rx="2" fill="${mid}"/>
           <rect x="${cx-45}" y="${cy-2}" width="60" height="4" rx="2" fill="${mid}"/>
           <circle cx="${cx+35}" cy="${cy+18}" r="8" fill="${fg}"/>`; break;
    case 'sticker':
      art=`<circle cx="${cx}" cy="${cy}" r="50" fill="white" stroke="${fg}" stroke-width="3" stroke-dasharray="4 3"/>
           <path d="M${cx-25} ${cy+10} Q${cx} ${cy-30} ${cx+25} ${cy+10}" fill="${fg}"/>
           <circle cx="${cx-15}" cy="${cy-5}" r="4" fill="white"/>
           <circle cx="${cx+15}" cy="${cy-5}" r="4" fill="white"/>`; break;
    case 'banner':
      art=`<rect x="${cx-70}" y="${cy-35}" width="140" height="50" fill="${fg}"/>
           <polygon points="${cx-70},${cy+15} ${cx-55},${cy+25} ${cx-70},${cy+35}" fill="${fg}"/>
           <polygon points="${cx+70},${cy+15} ${cx+55},${cy+25} ${cx+70},${cy+35}" fill="${fg}"/>
           <rect x="${cx-50}" y="${cy-20}" width="100" height="8" rx="2" fill="white"/>
           <rect x="${cx-40}" y="${cy-3}" width="80" height="6" rx="2" fill="${mid}"/>`; break;
    case 'flyer':
      art=`<rect x="${cx-40}" y="${cy-55}" width="80" height="110" rx="4" fill="white" stroke="${fg}" stroke-width="2"/>
           <rect x="${cx-32}" y="${cy-45}" width="64" height="22" rx="2" fill="${fg}"/>
           <rect x="${cx-32}" y="${cy-15}" width="50" height="4" rx="2" fill="${mid}"/>
           <rect x="${cx-32}" y="${cy-5}" width="64" height="4" rx="2" fill="${mid}"/>
           <rect x="${cx-32}" y="${cy+5}" width="55" height="4" rx="2" fill="${mid}"/>`; break;
    case 'mug':
      art=`<path d="M${cx-35} ${cy-30} L${cx-35} ${cy+30} Q${cx-35} ${cy+45} ${cx-15} ${cy+45} L${cx+20} ${cy+45} Q${cx+40} ${cy+45} ${cx+40} ${cy+30} L${cx+40} ${cy-30} Z" fill="white" stroke="${fg}" stroke-width="2"/>
           <path d="M${cx+40} ${cy-15} Q${cx+65} ${cy-15} ${cx+65} ${cy+10} Q${cx+65} ${cy+30} ${cx+40} ${cy+25}" fill="none" stroke="${fg}" stroke-width="3"/>
           <circle cx="${cx+5}" cy="${cy+10}" r="10" fill="${mid}"/>`; break;
    case 'frame':
      art=`<rect x="${cx-50}" y="${cy-40}" width="100" height="80" rx="4" fill="#7c2d12"/>
           <rect x="${cx-42}" y="${cy-32}" width="84" height="64" fill="${bg}"/>
           <circle cx="${cx-20}" cy="${cy-10}" r="12" fill="${fg}"/>
           <polygon points="${cx-25},${cy+25} ${cx-5},${cy-5} ${cx+25},${cy+25}" fill="${mid}"/>`; break;
    case 'greet':
      art=`<rect x="${cx-50}" y="${cy-35}" width="100" height="70" rx="4" fill="white" stroke="${fg}" stroke-width="2"/>
           <line x1="${cx}" y1="${cy-35}" x2="${cx}" y2="${cy+35}" stroke="${mid}" stroke-width="1.5"/>
           <path d="M${cx+25} ${cy-10} Q${cx+35} ${cy-20} ${cx+45} ${cy-10}" fill="none" stroke="${fg}" stroke-width="2"/>
           <circle cx="${cx+30}" cy="${cy-20}" r="3" fill="${fg}"/>
           <circle cx="${cx-30}" cy="${cy+10}" r="3" fill="${fg}"/>`; break;
    case 'tee':
      art=`<path d="M${cx-50} ${cy-30} L${cx-30} ${cy-45} L${cx-30} ${cy-35} L${cx+30} ${cy-35} L${cx+30} ${cy-45} L${cx+50} ${cy-30} L${cx+40} ${cy-5} L${cx+30} ${cy-5} L${cx+30} ${cy+50} L${cx-30} ${cy+50} L${cx-30} ${cy-5} L${cx-40} ${cy-5} Z" fill="white" stroke="${fg}" stroke-width="2"/>
           <text x="${cx}" y="${cy+20}" text-anchor="middle" font-family="Inter" font-weight="800" font-size="16" fill="${fg}">pz</text>`; break;
  }
  return `<svg viewBox="0 0 ${size} ${size}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><rect width="${size}" height="${size}" rx="16" fill="${bg}"/>${art}</svg>`;
}

/* ---- shared nav shell helpers ---- */
function renderTopbarCustomer(opts={}){
  const cart = Data.cart();
  const cartCount = cart.reduce((s,i)=>s+i.quantity,0);
  const sess = Auth.customer();
  const onHome = typeof isHome !== 'undefined' && isHome;
  return `
  <header class="topbar">
    <div class="topbar-inner">
      <a href="index.html" class="brand"><div class="brand-logo">pz</div><span class="sm-inline">printez</span></a>
      ${onHome && opts.showSearch!==false? `
        <div class="topbar-search" style="max-width:none;flex:1"><span>🔍</span><input id="top-search" type="search" placeholder="Search visiting cards, mugs, frames…"/></div>
      ` : `
        <div class="topbar-search"><span>📍</span><span>Kharghar, Navi Mumbai</span></div>
      `}
      <div class="topbar-actions">
        <a href="cart.html" class="icon-btn" aria-label="Cart">🛒${cartCount>0?`<span class="dot">${cartCount}</span>`:''}</a>
        <a href="orders.html" class="icon-btn" aria-label="Orders">📦</a>
        <div class="relative" id="profile-menu-wrap">
          <button id="profile-btn" class="icon-btn">👤</button>
        </div>
      </div>
    </div>
  </header>
  <div id="profile-sheet"></div>`;
}
function renderBottomNavCustomer(active){
  const cart = Data.cart();
  const cartCount = cart.reduce((s,i)=>s+i.quantity,0);
  const items = [
    {id:'home',href:'index.html',icon:'🏠',label:'Shop'},
    {id:'cart',href:'cart.html',icon:'🛒',label:'Cart',count:cartCount},
    {id:'orders',href:'orders.html',icon:'📦',label:'Orders'},
    {id:'me',href:'profile.html',icon:'👤',label:'Me'},
  ];
  return `<nav class="bottomnav"><div class="bottomnav-inner">
    ${items.map(i=>`<a href="${i.href}" class="${active===i.id?'active':''}"><span class="ic">${i.icon}${i.count?`<span class="cnt">${i.count}</span>`:''}</span><span>${i.label}</span></a>`).join('')}
  </div></nav>`;
}

function bindCustomerShell(){
  // profile menu
  const btn = document.getElementById('profile-btn');
  const sheet = document.getElementById('profile-sheet');
  if(btn && sheet){
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      if(sheet.innerHTML){ sheet.innerHTML=''; return; }
      const sess = Auth.customer();
      sheet.innerHTML = `<div style="position:fixed;top:60px;right:12px;background:#fff;border:1px solid var(--ink-200);border-radius:14px;box-shadow:var(--shadow-pop);padding:8px;min-width:200px;z-index:100" id="profile-pop">
        ${sess?`<div style="padding:10px;border-bottom:1px solid var(--ink-100);margin-bottom:6px"><div style="font-weight:700">${sess.name||'Customer'}</div><div class="muted text-xs">${sess.phone}</div></div>
        <a href="profile.html" style="display:block;padding:10px;border-radius:8px;font-size:14px;font-weight:600">My profile</a>
        <a href="orders.html" style="display:block;padding:10px;border-radius:8px;font-size:14px;font-weight:600">My orders</a>
        <button id="logout-c" style="display:block;width:100%;text-align:left;padding:10px;border-radius:8px;font-size:14px;font-weight:600;color:var(--bad)">Log out</button>`
        :`<a href="login.html" style="display:block;padding:10px;border-radius:8px;font-size:14px;font-weight:700;color:var(--brand-700)">Sign in / Sign up</a>
           <a href="../index.html" style="display:block;padding:10px;border-radius:8px;font-size:14px;font-weight:600;color:var(--ink-500)">Switch portal</a>`}
      </div>`;
      setTimeout(()=>{
        const pop = document.getElementById('profile-pop');
        const closer = (ev)=>{ if(!pop.contains(ev.target)){ sheet.innerHTML=''; document.removeEventListener('click',closer);} };
        document.addEventListener('click', closer);
        const lo = document.getElementById('logout-c');
        if(lo) lo.addEventListener('click',()=>{ Auth.clearCustomer(); toast('Logged out','success'); setTimeout(()=>location.href='login.html',400); });
      },10);
    });
  }
}

/* Seller/Admin sidebar */
function renderSellerSidebar(active){
  const sess = Auth.seller();
  const shop = sess?Data.shopById(sess.shopId):null;
  const pending = Data.orders().filter(o=>o.shopId===sess?.shopId && ['placed','assigned'].includes(o.status)).length;
  return `<div id="sidebar-backdrop" class="sidebar-back hidden"></div>
  <aside class="sidebar" id="sidebar">
    <a href="../index.html" class="brand"><div class="brand-logo" style="background:#059669">S</div><span>Seller portal</span></a>
    ${shop?`<div class="card card-pad" style="margin:0 4px 14px;background:#f0fdf4;border-color:#bbf7d0">
      <div style="font-weight:700;font-size:14px">${shop.name}</div>
      <div class="text-xs muted">${shop.status==='approved'?'<span class="flag flag-ok">● Approved</span>':'<span class="flag">● Pending review</span>'}</div>
    </div>`:''}
    <nav>
      <a href="dashboard.html" class="nav-item ${active==='dashboard'?'active':''}"><span class="ico">📊</span>Dashboard${pending?`<span class="badge-sm">${pending}</span>`:''}</a>
      <a href="orders.html" class="nav-item ${active==='orders'?'active':''}"><span class="ico">📦</span>Orders${pending?`<span class="badge-sm">${pending}</span>`:''}</a>
      <a href="products.html" class="nav-item ${active==='products'?'active':''}"><span class="ico">🛍️</span>Products</a>
      <a href="add-product.html" class="nav-item ${active==='add-product'?'active':''}"><span class="ico">➕</span>Add product</a>
      <a href="profile.html" class="nav-item ${active==='profile'?'active':''}"><span class="ico">🏪</span>Shop profile</a>
      <a href="earnings.html" class="nav-item ${active==='earnings'?'active':''}"><span class="ico">💰</span>Earnings</a>
    </nav>
    <div class="sidebar-footer">
      <button id="seller-logout" class="btn btn-outline btn-block btn-sm">Log out</button>
      <a href="../index.html" class="text-xs muted" style="display:block;text-align:center;margin-top:8px">← Switch portal</a>
    </div>
  </aside>`;
}
function bindSellerShell(){
  document.getElementById('seller-logout')?.addEventListener('click',()=>{
    Auth.clearSeller(); toast('Logged out','success'); setTimeout(()=>location.href='login.html',400);
  });
  // mobile toggle
  const tog = document.getElementById('mobile-toggle');
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  if(tog && sb){
    tog.addEventListener('click',()=>{ sb.classList.add('open'); bd.classList.remove('hidden'); });
    bd.addEventListener('click',()=>{ sb.classList.remove('open'); bd.classList.add('hidden'); });
  }
}

function renderAdminSidebar(active){
  const pendingShops = Data.shops().filter(s=>s.status==='pending').length;
  const unassigned = Data.orders().filter(o=>!o.shopId).length;
  return `<div id="sidebar-backdrop" class="sidebar-back hidden"></div>
  <aside class="sidebar" id="sidebar">
    <a href="../index.html" class="brand"><div class="brand-logo" style="background:#4f46e5">A</div><span>Admin · HQ</span></a>
    <nav>
      <a href="dashboard.html" class="nav-item ${active==='dashboard'?'active':''}"><span class="ico">📊</span>Overview</a>
      <a href="shops.html" class="nav-item ${active==='shops'?'active':''}"><span class="ico">🏪</span>Shops${pendingShops?`<span class="badge-sm">${pendingShops}</span>`:''}</a>
      <a href="orders.html" class="nav-item ${active==='orders'?'active':''}"><span class="ico">📦</span>All orders</a>
      <a href="assign.html" class="nav-item ${active==='assign'?'active':''}"><span class="ico">🔀</span>Assign orders${unassigned?`<span class="badge-sm">${unassigned}</span>`:''}</a>
      <a href="products.html" class="nav-item ${active==='products'?'active':''}"><span class="ico">🛍️</span>Catalog</a>
      <a href="commission.html" class="nav-item ${active==='commission'?'active':''}"><span class="ico">💰</span>Commission</a>
      <a href="quality.html" class="nav-item ${active==='quality'?'active':''}"><span class="ico">⭐</span>Quality</a>
    </nav>
    <div class="sidebar-footer">
      <button id="admin-logout" class="btn btn-outline btn-block btn-sm">Log out</button>
      <a href="../index.html" class="text-xs muted" style="display:block;text-align:center;margin-top:8px">← Switch portal</a>
    </div>
  </aside>`;
}
function bindAdminShell(){
  document.getElementById('admin-logout')?.addEventListener('click',()=>{
    Auth.clearAdmin(); toast('Logged out','success'); setTimeout(()=>location.href='login.html',400);
  });
  const tog = document.getElementById('mobile-toggle');
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  if(tog && sb){
    tog.addEventListener('click',()=>{ sb.classList.add('open'); bd.classList.remove('hidden'); });
    bd.addEventListener('click',()=>{ sb.classList.remove('open'); bd.classList.add('hidden'); });
  }
}

function requireAuth(role){
  seedIfNeeded();
  if(role==='customer' && !Auth.customer()){ location.href='login.html'; return false; }
  if(role==='seller'){
    const s = Auth.seller();
    if(!s){ location.href='login.html'; return false; }
  }
  if(role==='admin' && !Auth.admin()){ location.href='login.html'; return false; }
  return true;
}

/* ---- page head (shared assets) ---- */
function headExtra(title){
  return `<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<meta name="theme-color" content="#c2410c"/>
<title>${title} · printez</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='7' fill='%23c2410c'/%3E%3Ctext x='16' y='22' font-family='Inter' font-size='18' font-weight='800' text-anchor='middle' fill='white'%3Epz%3C/text%3E%3C/svg%3E"/>
<link rel="stylesheet" href="../assets/css/app.css"/>`;
}

/* ---- on page load helper ---- */
function pageLoaded(){
  seedIfNeeded();
  // Inject PWA manifest + apple-touch meta once
  if(!document.querySelector('link[rel="manifest"]')){
    const base = (location.pathname.includes('/customer/')||location.pathname.includes('/seller/')||location.pathname.includes('/admin/')) ? '../' : './';
    const m = document.createElement('link'); m.rel='manifest'; m.href=base+'manifest.webmanifest'; document.head.appendChild(m);
    // Apple touch icon inline SVG
    const a = document.createElement('link'); a.rel='apple-touch-icon'; a.href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 180 180'%3E%3Crect width='180' height='180' rx='40' fill='%23c2410c'/%3E%3Ctext x='90' y='122' font-family='Inter,Arial' font-size='86' font-weight='800' text-anchor='middle' fill='white'%3Epz%3C/text%3E%3C/svg%3E"; document.head.appendChild(a);
    const mt = document.createElement('meta'); mt.name='apple-mobile-web-app-capable'; mt.content='yes'; document.head.appendChild(mt);
    const ms = document.createElement('meta'); ms.name='apple-mobile-web-app-status-bar-style'; ms.content='black-translucent'; document.head.appendChild(ms);
    const mm = document.createElement('meta'); mm.name='apple-mobile-web-app-title'; mm.content='printez'; document.head.appendChild(mm);
    const msp = document.createElement('meta'); msp.name='mobile-web-app-capable'; msp.content='yes'; document.head.appendChild(msp);
  }
}
