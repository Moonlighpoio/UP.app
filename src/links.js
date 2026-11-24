/**
 * UP · Deep links y verificación de enlaces.
 * Regla crítica: URL canónica primero; si no existe, búsqueda EXACTA por
 * SKU/GTIN. Nunca se construye una URL a partir del nombre del producto.
 */
import { $, safeHttpUrl } from './utils.js';
import { state, getLinkVerification, setLinkVerification, addReindex } from './state.js';

export const CHAIN_SEARCH = {
  lider: 'https://www.lider.cl/supermercado/busqueda?ft=',
  jumbo: 'https://www.jumbo.cl/busqueda?ft=',
  santaisabel: 'https://www.santaisabel.cl/busqueda?ft=',
  tottus: 'https://www.tottus.cl/tottus/busqueda?ft=',
  unimarc: 'https://www.unimarc.cl/busqueda?ft=',
};

export function offerLink(product, chainId) {
  const mapping = (product.skus && product.skus[chainId]) || {};
  // La URL del feed pasa por saneamiento: nunca se inyecta javascript:/data: en un href.
  const canonical = safeHttpUrl(mapping.url);
  if (canonical) {
    return { url: canonical, canonical: true, token: mapping.sku || mapping.gtin, kind: 'ficha' };
  }
  const token = mapping.sku || mapping.gtin;
  const search =
    token && CHAIN_SEARCH[chainId]
      ? safeHttpUrl(CHAIN_SEARCH[chainId] + encodeURIComponent(token))
      : null;
  if (search) {
    return { url: search, canonical: false, token, kind: 'SKU' };
  }
  return { url: null, canonical: false, token: null, kind: 'none' };
}

export function reindexKey(productId, chainId) {
  return productId + '|' + chainId;
}

/**
 * @param {object} hooks onUpdate vuelve a renderizar el modal activo; notify muestra un toast.
 */
export async function verifyLink(url, productId, chainId, quiet, hooks = {}) {
  const onUpdate = hooks.onUpdate || (() => {});
  const notify = hooks.notify || (() => {});

  if (!url || (getLinkVerification(url) || {}).loading) return;
  setLinkVerification(url, { loading: true });
  try {
    const res = await fetch('/api/verify-link?url=' + encodeURIComponent(url), {
      headers: { Accept: 'application/json' },
    });
    const json = await res.json();
    setLinkVerification(url, Object.assign({}, json, { loading: false }));
    if (!json.ok) addReindex(reindexKey(productId, chainId));
  } catch (err) {
    setLinkVerification(url, { ok: false, status: 0, error: err.message, loading: false });
    addReindex(reindexKey(productId, chainId));
  }
  if (!quiet && state.activeProductId && !$('compare-modal').classList.contains('hidden')) {
    onUpdate();
    if (state.reindexQueue.size) notify('ENLACE NO DISPONIBLE · REINDEXANDO');
  }
}
