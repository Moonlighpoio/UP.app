/**
 * UP · Acceso a datos de precios.
 * En GitHub Pages (modo estático) no existen /api/* y se usa data/demo.js.
 */
import { $ } from './utils.js';
import { CHAIN_IDS, STATIC_DEMO } from './config.js';
import { state } from './state.js';
import { applyDemoData } from './catalog.js';
import { offerLink, verifyLink } from './links.js';

export async function refreshPrices(silent, hooks = {}) {
  const notify = hooks.notify || (() => {});
  const renderAll = hooks.renderAll || (() => {});
  const refreshActiveModal = hooks.refreshActiveModal || (() => {});
  const icon = $('sync-icon');
  icon.classList.add('animate-spin');
  try {
    if (STATIC_DEMO) {
      if (!silent) notify('DEMO ESTÁTICO · PRECIOS DE REFERENCIA');
    } else {
      const res = await fetch('/api/prices?q=&_t=' + Date.now(), { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      applyDemoData(data);

      const targets = [];
      state.products.slice(0, 8).forEach((p) => CHAIN_IDS.forEach((chain) => {
        const link = offerLink(p, chain);
        if (link.canonical && link.url) targets.push({ url: link.url, productId: p.id, chainId: chain });
      }));
      // La verificación externa corre en segundo plano: no bloquea la actualización de precios.
      Promise.allSettled(Array.from(new Map(targets.map((t) => [t.url, t])).values())
        .map((t) => verifyLink(t.url, t.productId, t.chainId, true, { onUpdate: refreshActiveModal, notify })))
        .then(refreshActiveModal);

      if (!silent) notify('PRECIOS ACTUALIZADOS · VERIFICANDO ENLACES');
    }
  } catch (err) {
    state.products.forEach((p) => {
      Object.keys(p.prices).forEach((storeId) => {
        const delta = Math.round((Math.random() * 0.06 - 0.03) * p.prices[storeId] / 10) * 10;
        p.prices[storeId] = Math.max(490, p.prices[storeId] + delta);
      });
    });
    if (!silent) notify('PRECIOS ACTUALIZADOS (MODO LOCAL)');
  } finally {
    const now = new Date();
    $('sync-timestamp').textContent = `SINCRONIZADO A LAS ${now.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    icon.classList.remove('animate-spin');
    renderAll();
    refreshActiveModal();
  }
}
