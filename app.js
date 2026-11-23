/* ==========================================================================
   UP · Lógica del prototipo
   - Modo demo: usa data/demo.js
   - Modo datos reales: consulta GET /api/prices?q=... (ver server.js)
   - Marketplace: un cargo, 99% a supermercados, 1% retenido por UP.
   ========================================================================== */

const PLATFORM_FEE_RATE = 0.01; // 1% retenido del subtotal de productos

// Búsqueda exacta por SKU/GTIN (VTEX: parámetro `ft`). Nunca se busca por
// nombre genérico: si no hay URL canónica, el término es el identificador real.
const CHAIN_SEARCH = {
  lider: "https://www.lider.cl/supermercado/busqueda?ft=",
  jumbo: "https://www.jumbo.cl/busqueda?ft=",
  tottus: "https://www.tottus.cl/tottus/busqueda?ft=",
  unimarc: "https://www.unimarc.cl/busqueda?ft=",
  santaisabel: "https://www.santaisabel.cl/busqueda?ft=",
  coope: "https://www.coope.cl/busqueda?ft="
};

const state = {
  data: null,
  offers: [],
  query: "Coca-Cola",
  sort: "price",
  category: "",
  chains: new Set(),
  onlyPromo: false,
  onlyStock: false,
  onlyFreeShip: false,
  maxDelivery: 0,
  cart: new Map(),
  comuna: "Providencia",
  syncing: false,
  syncedAt: null,
  activeProductId: null,
  receipt: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => "$" + Math.round(n).toLocaleString("es-CL");
const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const varianceByIndex = [0, 30, -20, 50, 10, -40, 25, -10, 60, 0];

/* ---------------- Enlaces profundos por SKU (deep linking) ---------------- */
const linkVerification = new Map();   // url -> { ok, status, checkedAt, loading, error }
const reindexQueue = new Set();       // "productId|chain" pendientes de re-indexación

function offerLink(o) {
  const mapping = (o.product.skus && o.product.skus[o.chain]) || {};
  if (mapping.url) {
    return {
      url: mapping.url, canonical: true, exact: true, kind: "ficha",
      sku: mapping.sku, gtin: mapping.gtin
    };
  }
  const token = mapping.sku || mapping.gtin;
  const base = CHAIN_SEARCH[o.chain];
  if (token && base) {
    return {
      url: base + encodeURIComponent(token), canonical: false, exact: true,
      kind: "SKU", sku: mapping.sku, gtin: mapping.gtin
    };
  }
  return { url: null, canonical: false, exact: false, kind: "sin SKU", sku: null, gtin: null };
}

function reindexKey(productId, chainId) { return productId + "|" + chainId; }

function markForReindex(productId, chainId) {
  reindexQueue.add(reindexKey(productId, chainId));
  render();
}

function markUrlForReindex(url) {
  state.offers.forEach((o) => {
    if (offerLink(o).url === url) reindexQueue.add(reindexKey(o.productId, o.chain));
  });
}

async function verifyOfferLink(url, quiet) {
  if (!url || (linkVerification.get(url) || {}).loading) return;
  linkVerification.set(url, { loading: true });
  if (!quiet) render();
  try {
    const res = await fetch("/api/verify-link?url=" + encodeURIComponent(url), {
      headers: { Accept: "application/json" }
    });
    const json = await res.json();
    linkVerification.set(url, Object.assign({}, json, { loading: false }));
    if (!json.ok) markUrlForReindex(url); // 404 → re-indexación inmediata
  } catch (err) {
    linkVerification.set(url, {
      ok: false, status: 0, error: err.message,
      checkedAt: new Date().toISOString(), loading: false
    });
    markUrlForReindex(url);
  }
  if (!quiet) {
    render();
    if (state.activeProductId) openProductDetail(state.activeProductId);
  }
}

/* --------------------------- Avisos --------------------------------------- */
const NOTICE_KEY = "up.hiddenNotices";
function hiddenNotices() {
  try { return new Set(JSON.parse(localStorage.getItem(NOTICE_KEY) || "[]")); }
  catch (_) { return new Set(); }
}
function hideNotice(id) {
  const hidden = hiddenNotices();
  hidden.add(id);
  try { localStorage.setItem(NOTICE_KEY, JSON.stringify(Array.from(hidden))); } catch (_) {}
  applyNoticeVisibility();
}
function applyNoticeVisibility() {
  const hidden = hiddenNotices();
  [["statusStrip", "#statusStrip"], ["footerNote", "#footerNote"], ["legalMini", "#legalMini"]]
    .forEach(([id, sel]) => {
      const el = $(sel);
      if (el) el.classList.toggle("is-hidden", hidden.has(id));
    });
  const restore = $("#restoreNotices");
  if (restore) restore.hidden = hidden.size === 0;
}

/* --------------------------- Carga de datos ------------------------------ */
async function loadData(force) {
  try {
    const stamp = force ? "&_t=" + Date.now() : "";
    const res = await fetch("/api/prices?q=" + encodeURIComponent(state.query) + stamp, {
      headers: { Accept: "application/json" }
    });
    if (res.ok) {
      const json = await res.json();
      if (json && json.products && json.stores && json.chains) return json;
    }
  } catch (_) {
    // file:// o sin servidor → modo demo
  }
  return window.UP_DEMO_DATA;
}

function buildOffers(data) {
  const out = [];
  data.products.forEach((p) => {
    data.stores.forEach((store, i) => {
      const base = p.prices[store.chain];
      if (base == null) return;
      const price = base + (varianceByIndex[i] || 0);
      let stock = "ok";
      if ((i === 8 && p.id.includes("cafe")) || (i === 5 && p.id.includes("huevos"))) stock = "out";
      else if (i === 4 || i === 9) stock = "low";

      out.push({
        key: p.id + "|" + store.id,
        productId: p.id,
        product: p,
        storeId: store.id,
        store,
        chain: store.chain,
        price,
        unitPrice: price / p.unitAmount,
        stock,
        promo: (p.promos && p.promos[store.chain]) || null,
        distance: store.distanceKm,
        delivery: store.deliveryMinutes || 999
      });
    });
  });
  return out;
}

/* --------------------------- Inicialización ------------------------------ */
async function init() {
  state.data = await loadData(false);
  state.offers = buildOffers(state.data);
  state.chains = new Set(Object.keys(state.data.chains));
  state.syncedAt = new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
  applyNoticeVisibility();
  renderStatus();
  renderFilters();
  renderCoverage();
  render();
  bindEvents();
}

function renderStatus() {
  const meta = state.data.meta || {};
  const live = meta.mode === "live";
  const badge = $("#statusBadge");
  badge.classList.toggle("live", live);
  badge.innerHTML = '<span class="status-dot"></span> ' + (live ? "EN VIVO · API conectada" : "MODO DEMO · precios referenciales");
  $("#statusNote").textContent = live
    ? "Datos actualizados " + (meta.generatedAt || "hoy")
    : "Datos de muestra para probar la interfaz · actualizado " + (meta.generatedAt || "—");
  $("#updatedAt").textContent = meta.generatedAt ? "Actualizado: " + meta.generatedAt : "";
  updateSync();
}

function updateSync() {
  const el = $("#syncIndicator");
  if (!el) return;
  const text = state.syncing
    ? "Sincronizando…"
    : "Sincronizado " + (state.syncedAt || (state.data && state.data.meta && state.data.meta.generatedAt) || "—");
  el.innerHTML = '<span class="sync-dot' + (state.syncing ? " pulse" : "") + '"></span> ' + esc(text);
}

function renderFilters() {
  const counts = {};
  state.offers.forEach((o) => { counts[o.chain] = (counts[o.chain] || 0) + 1; });
  $("#chainFilters").innerHTML = Object.entries(state.data.chains).map(([id, c]) => `
    <label>
      <input type="checkbox" class="chain-filter" value="${esc(id)}" ${state.chains.has(id) ? "checked" : ""} />
      <span class="chain-swatch"></span>
      ${esc(c.name)} <span style="color:var(--mute)">(${counts[id] || 0})</span>
    </label>`).join("");

  const select = $("#categoryFilter");
  const categories = Array.from(new Set(state.data.products.map((p) => p.category))).sort((a, b) => a.localeCompare(b, "es"));
  select.innerHTML = '<option value="">Todas las categorías</option>' + categories.map((cat) => `
    <option value="${esc(cat)}"${cat === state.category ? " selected" : ""}>${esc(cat)}</option>`).join("");
}

function renderCoverage() {
  $("#coverageGrid").innerHTML = Object.entries(state.data.chains).map(([id, c]) => `
    <div class="coverage-item">
      <span class="chain-badge">${esc(c.name.slice(0, 2).toUpperCase())}</span>
      <div><strong>${esc(c.name)}</strong><small>Despacho gratis desde ${money(c.freeShippingFrom)} · ${money(c.deliveryFee)} fuera de umbral</small></div>
    </div>`).join("");
}

/* --------------------------- Resultados ---------------------------------- */
function productOffers(productId) {
  return state.offers.filter((o) => o.productId === productId && state.chains.has(o.chain));
}
function priceStats(productId) {
  const list = productOffers(productId).filter((o) => o.stock !== "out");
  if (!list.length) return { min: Infinity, max: 0, spread: 0, available: 0 };
  const prices = list.map((o) => o.price);
  const min = Math.min(...prices), max = Math.max(...prices);
  return { min, max, spread: max - min, available: list.length };
}

function matchedProducts() {
  const q = norm(state.query.trim());
  let list = state.data.products.filter((p) => {
    if (state.category && p.category !== state.category) return false;
    const hay = norm(p.name + " " + p.detail + " " + p.category + " " + (p.description || ""));
    return !q || q.split(/\s+/).every((token) => hay.includes(token));
  });

  const cmp = {
    price: (a, b) => priceStats(a.id).min - priceStats(b.id).min,
    saving: (a, b) => priceStats(b.id).spread - priceStats(a.id).spread || priceStats(a.id).min - priceStats(b.id).min,
    availability: (a, b) => priceStats(b.id).available - priceStats(a.id).available || priceStats(a.id).min - priceStats(b.id).min,
    unit: (a, b) => priceStats(a.id).min / a.unitAmount - priceStats(b.id).min / b.unitAmount,
    distance: (a, b) => priceStats(a.id).min - priceStats(b.id).min,
    delivery: (a, b) => priceStats(a.id).min - priceStats(b.id).min
  }[state.sort];
  if (cmp) list.sort(cmp);
  return list;
}

function offersFor(productId) {
  let list = productOffers(productId);
  if (state.onlyPromo) list = list.filter((o) => o.promo);
  if (state.onlyStock) list = list.filter((o) => o.stock !== "out");
  if (state.maxDelivery) list = list.filter((o) => o.delivery <= state.maxDelivery);

  const cmp = {
    price: (a, b) => a.price - b.price,
    unit: (a, b) => a.unitPrice - b.unitPrice,
    distance: (a, b) => a.distance - b.distance || a.price - b.price,
    delivery: (a, b) => a.delivery - b.delivery || a.distance - b.distance || a.price - b.price
  }[state.sort];
  list.sort(cmp || ((a, b) => a.price - b.price));

  if (state.onlyFreeShip) {
    list = list.filter((o) => {
      const inCart = state.cart.get(o.key);
      const subtotal = inCart ? o.price * inCart.qty : 0;
      return subtotal >= state.data.chains[o.chain].freeShippingFrom;
    });
  }
  return list.slice(0, 10);
}

function comparatorOffers(productId) {
  // Vista de comparador: TODAS las franquicias, estrictamente de menor a mayor precio.
  return state.offers
    .filter((o) => o.productId === productId)
    .sort((a, b) => a.price - b.price);
}

function render() {
  const products = matchedProducts();
  const storesCount = new Set(state.offers.filter((o) => products.some((p) => p.id === o.productId)).map((o) => o.storeId)).size;

  $("#resultsTitle").textContent = state.query.trim()
    ? `Resultados para “${state.query.trim()}”`
    : "Todos los productos";
  $("#resultsMeta").textContent = products.length
    ? `${products.length} producto${products.length === 1 ? "" : "s"} · ${storesCount} locales cercanos a ${state.comuna} · precios ordenados de menor a mayor`
    : "Sin coincidencias";

  if (!products.length) {
    $("#resultsList").innerHTML = `<div class="no-results">No encontramos “${esc(state.query)}”. Prueba con Coca-Cola, leche, huevos, arroz, café o cambia la categoría.</div>`;
  } else {
    $("#resultsList").innerHTML = products.map(renderProduct).join("");
  }
  renderSaving(products);
  renderVerifyAlert(products);
  renderCart();
  updateSync();
}

function renderVerifyAlert(products) {
  const broken = [];
  products.forEach((p) => {
    state.offers.filter((o) => o.productId === p.id).forEach((o) => {
      const link = offerLink(o);
      const v = link.url && linkVerification.get(link.url);
      if (v && !v.loading && !v.ok) broken.push(`${p.name} · ${state.data.chains[o.chain].name}`);
    });
  });
  const alert = $("#verifyAlert");
  const parts = [];
  if (broken.length) {
    parts.push(`<strong>⚠️ ${broken.length} enlace${broken.length === 1 ? "" : "s"} no disponible${broken.length === 1 ? "" : "s"}.</strong>
      El precio podría no estar vigente. Marcado para re-indexación inmediata.
      <span>${esc(broken.slice(0, 3).join(" · "))}${broken.length > 3 ? " · …" : ""}</span>`);
  }
  if (reindexQueue.size) {
    parts.push(`<strong>🔄 ${reindexQueue.size} producto${reindexQueue.size === 1 ? "" : "s"} en cola de re-indexación de SKU.</strong>
      <span>El deep linker capturará la URL canónica en la siguiente pasada. Sin búsquedas genéricas: solo SKU/GTIN exacto.</span>`);
  }
  if (!parts.length) { alert.hidden = true; return; }
  alert.hidden = false;
  alert.innerHTML = parts.join("<br/>");
}

function productFigure(p) {
  if (!p.image) return `<div class="product-figure"><span class="product-emoji">${p.emoji || "📦"}</span></div>`;
  return `<div class="product-figure"><img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" /></div>`;
}

function detailButton(p) {
  return `<button class="detail-button" data-detail="${esc(p.id)}">Ver comparador completo ↗</button>`;
}

function linkMarkup(p, o, link) {
  const c = state.data.chains[o.chain];
  const v = link.canonical && link.url ? linkVerification.get(link.url) : null;
  const broken = !!(v && !v.loading && !v.ok);
  const verified = !!(v && !v.loading && v.ok);
  const pendingReindex = reindexQueue.has(reindexKey(p.id, o.chain));
  const title = !link.url
    ? "No existe mapeo SKU→URL para " + c.name + ". El deep linker debe capturarlo."
    : "SKU " + (link.sku || "—") + (link.gtin ? " · GTIN " + link.gtin : "") + " en " + c.name;

  let verifyLabel;
  let verifyClass = "";
  if (!link.url) {
    verifyLabel = pendingReindex ? "En cola de re-indexación" : "Sin SKU mapeado";
    verifyClass = "search";
  } else if (!link.canonical) {
    verifyLabel = "Búsqueda SKU exacta";
    verifyClass = "search";
  } else if (!v) {
    verifyLabel = "Verificar";
  } else if (v.loading) {
    verifyLabel = "Verificando…";
    verifyClass = "loading";
  } else if (v.ok) {
    verifyLabel = "Verificado ✓";
    verifyClass = "ok";
  } else {
    verifyLabel = "⚠ Enlace roto · reindexar";
    verifyClass = "broken";
  }
  const verifyAction = link.canonical && link.url
    ? `data-verify="${esc(link.url)}"`
    : !link.url ? `data-reindex="${esc(p.id)}|${esc(o.chain)}"` : "";
  const verifiedAt = verified && v.checkedAt
    ? `<small class="verified-at">${esc(String(v.checkedAt).slice(0, 10))}${v.cached ? " · caché" : ""}</small>` : "";

  return {
    broken,
    html: `<div class="compare-link">
      ${link.url ? `<a class="store-link" href="${esc(link.url)}" target="_blank" rel="noopener noreferrer" title="${esc(title)}">VER EN TIENDA ↗</a>
        <small class="sku-line">${link.kind === "ficha" ? "Ficha" : "SKU/GTIN"} ${esc(link.sku || link.gtin || "—")}</small>` : ""}
      <button class="verify-badge ${verifyClass}" ${verifyAction} title="${esc(title)}">${verifyLabel}</button>
      ${verifiedAt}
    </div>`
  };
}

function renderProduct(p) {
  const offers = offersFor(p.id);
  if (!offers.length) {
    return `<article class="product-card"><div class="product-head" data-detail="${esc(p.id)}">
      ${productFigure(p)}
      <div class="product-title"><h3>${esc(p.name)}</h3><p>${esc(p.detail)}</p>${detailButton(p)}</div>
      <div class="best-price"><small>Sin ofertas</small><span>Prueba otros filtros</span></div>
    </div></article>`;
  }
  const best = offers[0];
  const rows = offers.map((o) => {
    const c = state.data.chains[o.chain];
    const inCart = state.cart.has(o.key);
    const stockLabel = o.stock === "ok" ? "Disponible" : o.stock === "low" ? "Últimas unidades" : "Sin stock";
    const stockClass = o.stock === "ok" ? "stock-ok" : o.stock === "low" ? "stock-low" : "stock-out";
    const link = offerLink(o);
    const linkInfo = linkMarkup(p, o, link);

    return `<tr class="${o === best ? "best" : ""} ${linkInfo.broken ? "link-broken" : ""}">
      <td>
        <div class="store-cell">
          <span class="chain-badge">${esc(c.name.slice(0, 2).toUpperCase())}</span>
          <div><div class="store-name">${esc(o.store.name)}</div>
          <div class="store-meta">${esc(o.store.comuna)} · ${o.distance.toFixed(1)} km · ${o.delivery} min · ${esc(o.store.type)}</div></div>
        </div>
      </td>
      <td class="unit-cell">${money(o.unitPrice)} / ${esc(p.unitName)}</td>
      <td>${o.promo ? `<span class="promo">${esc(o.promo)}</span>` : "—"}</td>
      <td class="price-cell">${money(o.price)}<br/><span class="${stockClass}" style="font-size:10px">${stockLabel}</span>
        ${linkInfo.broken ? `<div class="link-warning">⚠ Precio no confirmado</div>` : ""}
      </td>
      <td class="verify-cell">${linkInfo.html}</td>
      <td><button class="add-btn" data-add="${esc(o.key)}" ${o.stock === "out" || linkInfo.broken ? "disabled" : ""} title="${linkInfo.broken ? "El enlace de verificación está roto" : "Agregar al carrito"}">${linkInfo.broken ? "No verificable" : inCart ? "Agregado ✓" : "Agregar"}</button></td>
    </tr>`;
  }).join("");

  return `<article class="product-card">
    <div class="product-head" data-detail="${esc(p.id)}">
      ${productFigure(p)}
      <div class="product-title">
        <h3>${esc(p.name)}</h3>
        <p>${esc(p.detail)} · ${esc(p.category)} · ${esc(p.unitLabel)}</p>
        <p class="product-description">${esc(p.description || "Sin descripción disponible.")}</p>
        ${detailButton(p)}
      </div>
      <div class="best-price"><small>Menor precio</small><strong>${money(best.price)}</strong>
      <span>${esc(state.data.chains[best.chain].name)} · ${money(best.unitPrice)}/${esc(p.unitName)}</span></div>
    </div>
    <table class="offer-table">
      <thead><tr><th>Local cercano</th><th>Precio unitario</th><th>Promo</th><th>Precio</th><th>Verificar en tienda</th><th>Comprar</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </article>`;
}

function renderSaving(products) {
  let saving = 0;
  if (state.cart.size) {
    state.cart.forEach((item) => {
      const all = state.offers.filter((o) => o.productId === item.offer.productId && o.stock !== "out");
      if (all.length) saving += (Math.max(...all.map((o) => o.price)) - item.offer.price) * item.qty;
    });
  } else {
    products.slice(0, 3).forEach((p) => { saving += priceStats(p.id).spread; });
  }
  $("#heroSaving").textContent = money(saving);
}

/* --------------------------- Carrito ------------------------------------- */
function groupCart() {
  const groups = {};
  state.cart.forEach((item, key) => {
    const chain = item.offer.chain;
    (groups[chain] = groups[chain] || []).push({ key, ...item });
  });
  return groups;
}

function addToCart(key) {
  const offer = state.offers.find((o) => o.key === key);
  if (!offer || offer.stock === "out") return false;
  if (state.cart.has(key)) state.cart.get(key).qty += 1;
  else state.cart.set(key, { offer, qty: 1 });
  return true;
}

function renderCart() {
  const count = Array.from(state.cart.values()).reduce((n, i) => n + i.qty, 0);
  $$(".cart-count").forEach((el) => { el.textContent = count; });
  const body = $("#cartBody");
  const foot = $("#cartFoot");

  if (!state.cart.size) {
    body.innerHTML = `<div class="empty-cart">Tu carrito está vacío.<br/><small>Agrega productos desde el comparador.</small></div>`;
    $("#checkoutSummary").innerHTML = "";
    foot.hidden = true;
    return;
  }

  const groups = groupCart();
  body.innerHTML = Object.entries(groups).map(([chainId, items]) => {
    const c = state.data.chains[chainId];
    const subtotal = items.reduce((s, i) => s + i.offer.price * i.qty, 0);
    const free = subtotal >= c.freeShippingFrom;
    const pct = Math.min(100, Math.round((subtotal / c.freeShippingFrom) * 100));
    const missing = Math.max(0, c.freeShippingFrom - subtotal);

    return `<div class="cart-group">
      <div class="cart-group-head">
        <span class="chain-badge">${esc(c.name.slice(0, 2).toUpperCase())}</span>
        Carrito ${esc(c.name)} <span class="subtotal">${money(subtotal)}</span>
      </div>
      ${items.map((i) => `<div class="cart-line">
        ${i.offer.product.image
          ? `<img class="cart-thumb" src="${esc(i.offer.product.image)}" alt="" />`
          : `<span>${i.offer.product.emoji}</span>`}
        <span class="line-name">${esc(i.offer.product.name)}<br/><small>${esc(i.offer.store.name)}</small></span>
        <span class="qty-controls">
          <button data-qty="${esc(i.key)}" data-delta="-1" aria-label="Quitar uno">−</button>
          <b>${i.qty}</b>
          <button data-qty="${esc(i.key)}" data-delta="1" aria-label="Agregar uno">+</button>
        </span>
        <strong>${money(i.offer.price * i.qty)}</strong>
      </div>`).join("")}
      <div class="ship-bar ${free ? "free" : ""}">
        ${free
          ? `✓ Despacho gratis alcanzado en ${esc(c.name)}`
          : `Agrega ${money(missing)} más en ${esc(c.name)} para despacho gratis sobre ${money(c.freeShippingFrom)}`}
        <div class="ship-track"><i style="width:${pct}%"></i></div>
      </div>
    </div>`;
  }).join("");

  const breakdown = cartBreakdown(groups);
  $("#cartTotals").innerHTML = `
    <div class="total-row"><span>Productos (${breakdown.cartCount} carrito${breakdown.cartCount === 1 ? "" : "s"})</span><span>${money(breakdown.productSubtotal)}</span></div>
    <div class="total-row"><span>Despacho (por supermercado)</span><span>${breakdown.deliveryTotal ? money(breakdown.deliveryTotal) : "Gratis"}</span></div>
    <div class="total-row"><span>Comisión UP (1% · retenida del subtotal)</span><span>${money(breakdown.platformFee)}</span></div>
    <div class="total-row grand"><span>Total a pagar</span><span>${money(breakdown.total)}</span></div>`;
  $("#checkoutSummary").innerHTML = checkoutSummaryHtml(breakdown);
  foot.hidden = false;
}

/* -------------------- Resumen unificado (split payment) ------------------ */
function cartBreakdown(groups) {
  const lines = [];
  let productSubtotal = 0;
  let deliveryTotal = 0;
  let platformFee = 0;
  let payoutTotal = 0;

  Object.entries(groups).forEach(([chainId, items]) => {
    const c = state.data.chains[chainId];
    const subtotal = items.reduce((s, i) => s + i.offer.price * i.qty, 0);
    const free = subtotal >= c.freeShippingFrom;
    const delivery = free ? 0 : c.deliveryFee;
    const minutes = Math.min(...items.map((i) => i.offer.delivery));
    const fee = Math.round(subtotal * PLATFORM_FEE_RATE);   // 1% retenido por UP
    const payout = subtotal - fee;                           // 99% para la cadena

    productSubtotal += subtotal;
    deliveryTotal += delivery;
    platformFee += fee;
    payoutTotal += payout;
    lines.push({
      chainId, name: c.name, count: items.reduce((n, i) => n + i.qty, 0),
      subtotal, fee, payout, delivery, free, minutes
    });
  });

  // El fee ya está dentro del subtotal de productos: NO se suma al cobro.
  return {
    lines, cartCount: lines.length, productSubtotal, deliveryTotal,
    platformFee, payoutTotal, total: productSubtotal + deliveryTotal
  };
}

function checkoutSummaryHtml(b) {
  return `
    <div class="checkout-summary">
      <h3>Resumen de pago unificado</h3>
      <p class="checkout-intro">Un solo cargo en la pasarela; UP retiene el 1% y dispersa el 99% a cada supermercado.</p>
      <div class="checkout-carts">
        ${b.lines.map((l) => `<div class="checkout-cart">
          <span class="chain-badge">${esc(l.name.slice(0, 2).toUpperCase())}</span>
          <div><b>${esc(l.name)}</b><small>${l.count} productos · ${l.free ? "despacho gratis" : "despacho " + money(l.delivery)} · ${l.minutes} min</small></div>
          <strong>${money(l.subtotal)}</strong>
        </div>`).join("")}
      </div>
      <div class="total-row"><span>Subtotal productos</span><span>${money(b.productSubtotal)}</span></div>
      <div class="total-row"><span>Despacho total</span><span>${b.deliveryTotal ? money(b.deliveryTotal) : "Gratis"}</span></div>
      <div class="total-row"><span>Comisión UP (1% · retenida del subtotal)</span><span>${money(b.platformFee)}</span></div>
      <div class="total-row grand"><span>Total del cargo único</span><span>${money(b.total)}</span></div>
      <p class="legal-mini">Dispersión: ${money(b.payoutTotal)} a supermercados (99%) + ${money(b.platformFee)} retenidos por UP (1%). Cada cadena emite la boleta de sus productos; UP factura la intermediación. Validar con abogado tributarista.</p>
    </div>`;
}

function confirmPayment() {
  const b = cartBreakdown(groupCart());
  if (!b.lines.length) return;
  const now = new Date();
  state.receipt = {
    id: "UP-" + now.toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 6).toUpperCase(),
    at: now.toLocaleString("es-CL"),
    comuna: state.comuna,
    breakdown: b
  };
  const node = $("#splitReceipt");
  node.innerHTML = splitReceiptHtml(state.receipt);
  node.hidden = false;
  const btn = $("#confirmPayment");
  btn.innerHTML = "Pago confirmado ✓";
  btn.disabled = true;
}

function splitReceiptHtml(r) {
  const b = r.breakdown;
  const pctStore = b.productSubtotal ? (b.payoutTotal / b.productSubtotal) * 100 : 99;
  const pctUp = b.productSubtotal ? (b.platformFee / b.productSubtotal) * 100 : 1;
  return `
    <div class="receipt-head">
      <div>
        <h3>Comprobante de boleta dividida</h3>
        <span class="mono-label">SPLIT PAYMENT · ${esc(r.at)}</span>
      </div>
      <span class="receipt-id">${esc(r.id)}<br/>UP / MARKETPLACE</span>
    </div>

    <div class="split-flow">
      <span class="mono-label">FLUJO DEL CARGO ÚNICO · ${money(b.total)}</span>
      <div class="split-bar" aria-hidden="true"><i style="width:${pctStore}%"></i><i style="width:${pctUp}%"></i></div>
      <div class="split-legend">
        <span><b>99%</b> → supermercados</span>
        <span><b>1%</b> → UP</span>
      </div>
    </div>

    <div class="receipt-row"><span>Productos → supermercados (99%)</span><span>${money(b.payoutTotal)}</span></div>
    <div class="receipt-row"><span>Comisión retenida por UP (1%)</span><span>${money(b.platformFee)}</span></div>
    <div class="receipt-row"><span>Despacho coordinado (logística)</span><span>${b.deliveryTotal ? money(b.deliveryTotal) : "Gratis"}</span></div>
    <div class="receipt-row total"><span>Cargo único en PSP</span><span>${money(b.total)}</span></div>

    <div class="receipt-section">
      <span class="mono-label">DISPERSIÓN POR FRANQUICIA</span>
      ${b.lines.map((l) => `
        <div class="receipt-row"><span>${esc(l.name)} · ${money(l.subtotal)}</span><span>${money(l.payout)} → tienda · ${money(l.fee)} → UP</span></div>
        <div class="receipt-row"><span>↳ Despacho ${esc(l.name)}</span><span>${l.free ? "Gratis (umbral alcanzado)" : money(l.delivery)} · ${l.minutes} min</span></div>`).join("")}
    </div>

    <div class="receipt-section">
      <span class="mono-label">ENTREGA COORDINADA</span>
      <p class="receipt-delivery">${b.lines.length} sub-carrito${b.lines.length === 1 ? "" : "s"} despachados a <b>${esc(r.comuna)}</b>. Cada supermercado prepara su pedido en su propio plazo (${b.lines.map((l) => esc(l.name) + " " + l.minutes + " min").join(" · ")}); UP coordina ventanas y notificaciones en un solo seguimiento.</p>
    </div>

    <p class="receipt-legal">Comprobante simulado para prototipo privado. La boleta de productos la emite cada supermercado; UP emite el documento por su comisión de intermediación. Modelo marketplace con split payment; revisar tratamiento SII / Ley 21.713 antes de operar.</p>
    <button class="btn" data-print-receipt style="margin-top:14px">Imprimir comprobante</button>
  `;
}

/* --------------------------- Comparador por producto --------------------- */
function openProductDetail(productId) {
  const p = state.data.products.find((x) => x.id === productId);
  if (!p) return;
  state.activeProductId = productId;
  const offers = comparatorOffers(p.id);
  const cheapest = offers.length ? offers[0] : null;
  const highest = offers.length ? offers[offers.length - 1] : null;
  const source = p.source || null;

  const rows = offers.map((o, idx) => {
    const c = state.data.chains[o.chain];
    const stockLabel = o.stock === "ok" ? "Disponible" : o.stock === "low" ? "Últimas unidades" : "Sin stock";
    const stockClass = o.stock === "ok" ? "stock-ok" : o.stock === "low" ? "stock-low" : "stock-out";
    const link = offerLink(o);
    const linkInfo = linkMarkup(p, o, link);
    const inCart = state.cart.has(o.key);

    return `<tr class="${o === cheapest ? "best" : ""} ${linkInfo.broken ? "link-broken" : ""}">
      <td class="compare-rank">(${String(idx + 1).padStart(2, "0")})</td>
      <td>
        <div class="store-cell">
          <span class="chain-badge">${esc(c.name.slice(0, 2).toUpperCase())}</span>
          <div><div class="store-name">${esc(c.name)}</div>
          <div class="store-meta">${esc(o.store.name)} · ${esc(o.store.comuna)} · ${o.distance.toFixed(1)} km · ${o.delivery} min</div></div>
        </div>
      </td>
      <td class="compare-price">${money(o.price)}<br/><span class="${stockClass}" style="font-size:9px">${stockLabel}</span>
        ${o.promo ? `<span class="promo">${esc(o.promo)}</span>` : ""}
        ${linkInfo.broken ? `<div class="link-warning">Precio no confirmado</div>` : ""}
      </td>
      <td class="compare-unit">${money(o.unitPrice)} / ${esc(p.unitName)}</td>
      <td>${linkInfo.html}</td>
      <td></td>
      <td><button class="add-btn" data-add="${esc(o.key)}" ${o.stock === "out" || linkInfo.broken ? "disabled" : ""}>${linkInfo.broken ? "No verificable" : inCart ? "Agregado ✓" : "AGREGAR AL CARRITO"}</button></td>
    </tr>`;
  }).join("");

  $("#productModalBody").innerHTML = `
    <div class="compare-head">
      ${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" />` : `<div class="product-figure"><span class="product-emoji">${p.emoji || "📦"}</span></div>`}
      <div>
        <span class="mono-label">COMPARADOR / ${esc(p.category)}</span>
        <h2 class="compare-title" id="compareTitle">${esc(p.name)}</h2>
        <p class="compare-detail">${esc(p.detail)} · ${esc(p.unitLabel)} · ${offers.length} ofertas</p>
        <p class="compare-desc">${esc(p.description || "Sin descripción disponible.")}</p>
        ${cheapest ? `<div class="compare-best"><small>MEJOR PRECIO</small><strong>${money(cheapest.price)}</strong><span>${esc(state.data.chains[cheapest.chain].name)} · ${money(cheapest.unitPrice)}/${esc(p.unitName)}</span></div>` : ""}
      </div>
    </div>

    <div class="compare-toolbar">
      <span class="compare-sync"><span class="sync-dot${state.syncing ? " pulse" : ""}"></span> ${state.syncing ? "Sincronizando precios…" : "Precios sincronizados " + esc(state.syncedAt || "—") + " · orden: menor a mayor"}</span>
      <button class="utility-button" data-refresh-compare ${state.syncing ? "disabled" : ""}>⟳ REFRESCAR PRECIOS</button>
    </div>

    <table class="compare-table">
      <thead><tr><th>#</th><th>Supermercado</th><th>Precio</th><th>Precio / ${esc(p.unitName)}</th><th>Ver en tienda</th><th></th><th>Comprar</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>

    ${source ? `<p class="compare-note">Imagen y descripción de referencia: ${esc(source.chain)} · capturado ${esc(source.capturedAt)} · <a href="${esc(source.url)}" target="_blank" rel="noopener noreferrer" class="store-link">ficha de origen ↗</a></p>` : ""}`;

  $("#productModal").hidden = false;
}

/* --------------------------- Refresco de precios ------------------------- */
async function refreshPrices() {
  if (state.syncing) return;
  state.syncing = true;
  updateSync();
  if (state.activeProductId) {
    const node = $("#productModalBody .compare-sync");
    if (node) node.innerHTML = '<span class="sync-dot pulse"></span> Sincronizando precios…';
  }
  try {
    const data = await loadData(true);
    state.data = data;
    state.offers = buildOffers(data);
    state.cart.forEach((item, key) => {
      const fresh = state.offers.find((o) => o.key === key);
      if (fresh) item.offer = fresh;
    });
    if (state.category && !data.products.some((p) => p.category === state.category)) state.category = "";
    state.syncedAt = new Date().toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });

    // Verifica disponibilidad de las fichas visibles (y del comparador abierto, si hay uno).
    const visibleIds = state.activeProductId
      ? [state.activeProductId]
      : matchedProducts().slice(0, 8).map((p) => p.id);
    const links = [];
    visibleIds.forEach((id) => comparatorOffers(id).forEach((o) => {
      const link = offerLink(o);
      if (link.canonical && link.url) links.push(link.url);
    }));
    await Promise.allSettled(Array.from(new Set(links)).map((url) => verifyOfferLink(url, true)));

    renderStatus();
    renderFilters();
    renderCoverage();
    render();
  } catch (err) {
    state.syncedAt = "sin conexión";
    render();
    console.warn("[UP] No se pudieron refrescar los precios:", err.message);
  } finally {
    state.syncing = false;
    updateSync();
    if (state.activeProductId) openProductDetail(state.activeProductId);
  }
}

/* --------------------------- Eventos ------------------------------------- */
function goToResults() {
  const target = document.getElementById("comparador");
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function bindEvents() {
  $("#searchForm").addEventListener("submit", (e) => {
    e.preventDefault();
    state.query = $("#searchInput").value.trim();
    render();
    goToResults();
  });

  $$(".chip").forEach((chip) => chip.addEventListener("click", () => {
    state.query = chip.dataset.query;
    $("#searchInput").value = state.query;
    render();
    goToResults();
  }));

  $$(".white-action").forEach((btn) => btn.addEventListener("click", () => {
    state.query = btn.dataset.query;
    $("#searchInput").value = state.query;
    render();
    goToResults();
  }));

  const menuToggle = $("#menuToggle");
  const navMenu = $("#navMenu");
  menuToggle.addEventListener("click", () => {
    const open = navMenu.classList.toggle("open");
    menuToggle.setAttribute("aria-expanded", String(open));
  });
  $$("#navMenu a").forEach((a) => a.addEventListener("click", () => {
    navMenu.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
  }));

  const finalCta = $("#finalCta");
  if (finalCta) finalCta.addEventListener("click", goToResults);

  $$(".acc-head").forEach((head) => head.addEventListener("click", () => {
    const item = head.closest(".acc-item");
    const wasOpen = item.classList.contains("open");
    $$(".acc-item").forEach((other) => {
      other.classList.remove("open");
      other.querySelector(".acc-head").setAttribute("aria-expanded", "false");
      other.querySelector(".acc-panel").hidden = true;
    });
    if (!wasOpen) {
      item.classList.add("open");
      head.setAttribute("aria-expanded", "true");
      item.querySelector(".acc-panel").hidden = false;
    }
  }));

  $$('input[name="sort"]').forEach((r) => r.addEventListener("change", () => {
    state.sort = r.value; render();
  }));

  $("#categoryFilter").addEventListener("change", (e) => {
    state.category = e.target.value; render();
  });

  $("#chainFilters").addEventListener("change", (e) => {
    if (!e.target.classList.contains("chain-filter")) return;
    e.target.checked ? state.chains.add(e.target.value) : state.chains.delete(e.target.value);
    render();
  });

  $("#onlyPromo").addEventListener("change", (e) => { state.onlyPromo = e.target.checked; render(); });
  $("#onlyStock").addEventListener("change", (e) => { state.onlyStock = e.target.checked; render(); });
  $("#onlyFreeShip").addEventListener("change", (e) => { state.onlyFreeShip = e.target.checked; render(); });
  $("#maxDelivery").addEventListener("change", (e) => { state.maxDelivery = Number(e.target.value); render(); });
  $("#comuna").addEventListener("change", (e) => { state.comuna = e.target.value; render(); });
  $("#refreshPrices").addEventListener("click", refreshPrices);

  $("#resultsList").addEventListener("click", (e) => {
    const reindex = e.target.closest("[data-reindex]");
    if (reindex) { e.preventDefault(); const [pid, chain] = reindex.dataset.reindex.split("|"); markForReindex(pid, chain); return; }
    const verify = e.target.closest("[data-verify]");
    if (verify) { e.preventDefault(); verifyOfferLink(verify.dataset.verify); return; }
    const detail = e.target.closest("[data-detail]");
    if (detail) { openProductDetail(detail.dataset.detail); return; }
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    if (addToCart(btn.dataset.add)) render();
  });

  $("#productModalBody").addEventListener("click", (e) => {
    if (e.target.closest("[data-refresh-compare]")) { refreshPrices(); return; }
    const reindex = e.target.closest("[data-reindex]");
    if (reindex) { e.preventDefault(); const [pid, chain] = reindex.dataset.reindex.split("|"); markForReindex(pid, chain); openProductDetail(pid); return; }
    const verify = e.target.closest("[data-verify]");
    if (verify) { e.preventDefault(); verifyOfferLink(verify.dataset.verify); return; }
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    if (addToCart(btn.dataset.add)) {
      render();
      openProductDetail(state.activeProductId);
    }
  });

  $("#cartBody").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-qty]");
    if (!btn) return;
    const item = state.cart.get(btn.dataset.qty);
    if (!item) return;
    item.qty += Number(btn.dataset.delta);
    if (item.qty <= 0) state.cart.delete(btn.dataset.qty);
    render();
  });

  const openCart = () => {
    $("#cartDrawer").classList.add("open");
    $("#cartDrawer").setAttribute("aria-hidden", "false");
    $("#overlay").hidden = false;
  };
  const closeCart = () => {
    $("#cartDrawer").classList.remove("open");
    $("#cartDrawer").setAttribute("aria-hidden", "true");
    $("#overlay").hidden = true;
  };
  $("#cartButton").addEventListener("click", openCart);
  $$("[data-open-cart]").forEach((b) => b.addEventListener("click", openCart));
  $("#closeCart").addEventListener("click", closeCart);
  $("#overlay").addEventListener("click", closeCart);

  const openModal = (id) => { $("#" + id).hidden = false; };
  const closeModals = () => {
    $$(".modal").forEach((m) => { m.hidden = true; });
    state.activeProductId = null;
  };
  $("#openDataModal").addEventListener("click", () => openModal("dataModal"));
  $("#openDataModalTop").addEventListener("click", () => openModal("dataModal"));
  $("#checkoutButton").addEventListener("click", () => {
    state.receipt = null;
    $("#splitReceipt").hidden = true;
    $("#splitReceipt").innerHTML = "";
    const btn = $("#confirmPayment");
    btn.disabled = false;
    btn.innerHTML = 'Confirmar pago <span aria-hidden="true">→</span>';
    renderCart();
    openModal("checkoutModal");
  });
  $("#confirmPayment").addEventListener("click", confirmPayment);
  $("#splitReceipt").addEventListener("click", (e) => {
    if (e.target.closest("[data-print-receipt]")) window.print();
  });

  $("#dismissStatus").addEventListener("click", () => hideNotice("statusStrip"));
  $("#dismissFooterNote").addEventListener("click", () => hideNotice("footerNote"));
  $("#dismissLegalMini").addEventListener("click", () => hideNotice("legalMini"));
  $("#restoreNotices").addEventListener("click", () => {
    try { localStorage.removeItem(NOTICE_KEY); } catch (_) {}
    applyNoticeVisibility();
  });
  $$("[data-close-modal]").forEach((b) => b.addEventListener("click", closeModals));
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) closeModals(); }));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeModals();
      closeCart();
      navMenu.classList.remove("open");
      menuToggle.setAttribute("aria-expanded", "false");
    }
  });
}

document.addEventListener("DOMContentLoaded", init);
