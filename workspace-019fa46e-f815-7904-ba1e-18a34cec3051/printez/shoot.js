const http=require('http'),fs=require('fs'),path=require('path');
const ROOT=__dirname;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'application/javascript','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml','.webmanifest':'application/manifest+json','.ico':'image/x-icon'};
const srv=http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]);
  if(p==='/'||p==='') p='/index.html';
  const fp=path.join(ROOT,p);
  if(!fp.startsWith(ROOT)){res.writeHead(403);return res.end('forbidden');}
  fs.readFile(fp,(e,d)=>{
    if(e){res.writeHead(404);return res.end('not found');}
    const ext=path.extname(fp).toLowerCase();
    res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream'});
    res.end(d);
  });
});

(async()=>{
  await new Promise(r=>srv.listen(8765,'127.0.0.1',r));
  console.log('serving on 8765');
  const puppeteer=require('puppeteer');
  const b = await puppeteer.launch({args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],headless:'new'});

  async function freshPage(vp){
    const p=await b.newPage();
    await p.setViewport(vp||{width:390,height:844,isMobile:true,deviceScaleFactor:2});
    // visit once to seed data by letting pageLoaded() populate localStorage defaults
    await p.goto('http://127.0.0.1:8765/customer/index.html',{waitUntil:'networkidle2',timeout:30000});
    await new Promise(r=>setTimeout(r,600));
    return p;
  }
  async function setSess(p, entries){
    await p.evaluate((e)=>{ for(const [k,v] of Object.entries(e)) localStorage.setItem(k, JSON.stringify(v)); }, entries);
  }
  async function shoot({url, file, vp, sess, cart, full=true}){
    const p = await freshPage(vp);
    const entries = {};
    if(sess) entries[sess.key] = sess.val;
    if(cart) entries['pz_cart_v1'] = cart;
    if(Object.keys(entries).length) await setSess(p, entries);
    await p.goto(url,{waitUntil:'networkidle2',timeout:30000});
    await new Promise(r=>setTimeout(r,900));
    await p.screenshot({path:file,fullPage:full});
    await p.close();
    console.log('shot',path.basename(file));
  }

  const mobile={width:390,height:844,isMobile:true,deviceScaleFactor:2};
  const desktop={width:1280,height:900,deviceScaleFactor:1};
  const custSess={key:'pz_sess_cust_v1',val:{id:'cust_demo_0001',phone:'9000000001',name:'Ananya Rao',createdAt:new Date().toISOString()}};
  const sellSess={key:'pz_sess_sell_v1',val:{shopId:'shop_1',phone:'9820011223',name:'Rajesh',loginAt:new Date().toISOString()}};
  const admSess={key:'pz_sess_adm_v1',val:{email:'a@a',name:'A',loginAt:new Date().toISOString()}};

  // Build a demo cart with 2 items by reading seeded product/listing ids on page
  const p = await b.newPage();
  await p.goto('http://127.0.0.1:8765/customer/index.html',{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,500));
  const demoCart = await p.evaluate(()=>{
    const prods = JSON.parse(localStorage.getItem('pz_products_v1'));
    const mug = prods.find(x=>x.id==='mug');
    const vc  = prods.find(x=>x.id==='visiting_cards');
    const ml = Object.values(mug._listingMap).find(l=>{const s=JSON.parse(localStorage.getItem('pz_shops_v1')).find(s=>s.id===l.shopId);return s&&s.status==='approved';});
    const vl = Object.values(vc._listingMap).find(l=>{const s=JSON.parse(localStorage.getItem('pz_shops_v1')).find(s=>s.id===l.shopId);return s&&s.status==='approved';});
    return [
      {key:'c_demo1',productId:'mug',listingId:ml.id,shopId:ml.shopId,shopName:'Kharghar Gift Gallery',specs:{option:'Black Magic Mug (₹449)'},quantity:2,unitPrice:449,lineTotal:898,addedAt:new Date().toISOString()},
      {key:'c_demo2',productId:'visiting_cards',listingId:vl.id,shopId:vl.shopId,shopName:'Shree Sai Printers',specs:{material:'Premium Gloss',sides:'double',size:'89×54 mm (Standard)'},quantity:100,unitPrice:4.375,lineTotal:438,addedAt:new Date().toISOString()}
    ];
  });
  await p.close();

  // Portal hub
  await shoot({url:'http://127.0.0.1:8765/',file:'shot-portal-hub.png',vp:desktop});

  // Customer public
  await shoot({url:'http://127.0.0.1:8765/customer/index.html',file:'shot-home.png',vp:mobile});
  await shoot({url:'http://127.0.0.1:8765/customer/login.html',file:'shot-login.png',vp:mobile});
  await shoot({url:'http://127.0.0.1:8765/customer/product.html?id=visiting_cards',file:'shot-product-vc.png',vp:mobile});
  await shoot({url:'http://127.0.0.1:8765/customer/product.html?id=mug',file:'shot-product-mug.png',vp:mobile});

  // Customer signed-in
  await shoot({url:'http://127.0.0.1:8765/customer/index.html',file:'shot-home-in.png',vp:mobile,sess:custSess});
  await shoot({url:'http://127.0.0.1:8765/customer/orders.html',file:'shot-orders.png',vp:mobile,sess:custSess});
  await shoot({url:'http://127.0.0.1:8765/customer/orders.html?id=ORD-1003',file:'shot-order-detail.png',vp:mobile,sess:custSess});
  await shoot({url:'http://127.0.0.1:8765/customer/profile.html',file:'shot-profile.png',vp:mobile,sess:custSess});
  await shoot({url:'http://127.0.0.1:8765/customer/cart.html',file:'shot-cart.png',vp:mobile,sess:custSess,cart:demoCart});

  // Seller desktop
  await shoot({url:'http://127.0.0.1:8765/seller/dashboard.html',file:'shot-seller-dash.png',vp:desktop,sess:sellSess});
  await shoot({url:'http://127.0.0.1:8765/seller/orders.html',file:'shot-seller-orders.png',vp:desktop,sess:sellSess});
  await shoot({url:'http://127.0.0.1:8765/seller/products.html',file:'shot-seller-products.png',vp:desktop,sess:sellSess});
  await shoot({url:'http://127.0.0.1:8765/seller/earnings.html',file:'shot-seller-earnings.png',vp:desktop,sess:sellSess});
  await shoot({url:'http://127.0.0.1:8765/seller/login.html',file:'shot-seller-login.png',vp:mobile});

  // Admin desktop
  await shoot({url:'http://127.0.0.1:8765/admin/dashboard.html',file:'shot-admin-dash.png',vp:desktop,sess:admSess});
  await shoot({url:'http://127.0.0.1:8765/admin/shops.html',file:'shot-admin-shops.png',vp:desktop,sess:admSess});
  await shoot({url:'http://127.0.0.1:8765/admin/assign.html',file:'shot-admin-assign.png',vp:desktop,sess:admSess});
  await shoot({url:'http://127.0.0.1:8765/admin/orders.html',file:'shot-admin-orders.png',vp:desktop,sess:admSess});
  await shoot({url:'http://127.0.0.1:8765/admin/quality.html',file:'shot-admin-quality.png',vp:desktop,sess:admSess});
  await shoot({url:'http://127.0.0.1:8765/admin/commission.html',file:'shot-admin-commission.png',vp:desktop,sess:admSess});
  await shoot({url:'http://127.0.0.1:8765/admin/products.html',file:'shot-admin-products.png',vp:desktop,sess:admSess});

  await b.close();
  srv.close();
  console.log('done');
})().catch(e=>{console.error(e);process.exit(1);});
