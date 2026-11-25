/**
 * UP · Sugerencias y tolerancia a errores de tipeo (FASE U2).
 * Funciones puras: sin DOM, sin localStorage y sin librerías externas.
 */
import { esc } from './utils.js';

export const MAX_RECENT_SEARCHES = 8;

export function brandOf(product) {
  return String(product?.name || '')
    .split(/\s+/)
    .slice(0, 2)
    .join(' ');
}

/** Distancia de Levenshtein acotada: devuelve max+1 si se excede el límite. */
export function editDistance(left, right, max = 2) {
  const a = String(left || '').toLowerCase();
  const b = String(right || '').toLowerCase();
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > max) return max + 1;
    previous = current;
  }
  return previous[b.length];
}

function words(value) {
  return String(value || '')
    .toLowerCase()
    .split(/[^a-z0-9áéíóúñ]+/)
    .filter(Boolean);
}

export function approximateMatch(query, text, max = 2) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const t = String(text || '')
    .trim()
    .toLowerCase();
  if (!q) return false;
  if (t.includes(q)) return true;
  const queryWords = words(q);
  const textWords = words(t);
  if (!queryWords.length || !textWords.length) return false;
  // Cada término buscado debe parecerse a algún término conocido: evita
  // sugerencias por una sola coincidencia débil en búsquedas multi-palabra.
  return queryWords.every((queryWord) =>
    textWords.some(
      (textWord) => textWord.length >= 3 && editDistance(queryWord, textWord, max) <= max
    )
  );
}

function addSuggestion(out, seen, item) {
  // Un mismo texto no se repite aunque aparezca como reciente, popular y catálogo.
  const key = item.value.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  out.push(item);
}

/**
 * Sugerencias de productos, marcas y categorías. Recientes y populares se
 * anteponen cuando el término es corto; todos los textos son datos del catálogo
 * o búsquedas hechas en este navegador (nada inventado).
 */
export function suggestionsFor(query, products, options = {}) {
  const q = String(query || '').trim();
  const recent = Array.isArray(options.recent) ? options.recent : [];
  const popular = Array.isArray(options.popular) ? options.popular : [];
  const limit = options.limit || 8;
  const out = [];
  const seen = new Set();

  if (q.length < 2) {
    recent
      .slice(0, limit)
      .forEach((value) => addSuggestion(out, seen, { type: 'reciente', label: value, value }));
    popular
      .slice(0, limit - out.length)
      .forEach((value) => addSuggestion(out, seen, { type: 'popular', label: value, value }));
    return out.slice(0, limit);
  }

  const scored = [];
  const lower = q.toLowerCase();
  for (const product of products) {
    const candidates = [
      { type: 'producto', value: product.name, productId: product.id, meta: product.category },
      { type: 'marca', value: brandOf(product), meta: 'Marca' },
      { type: 'categoria', value: product.category, meta: 'Categoría' },
    ];
    for (const candidate of candidates) {
      const text = candidate.value.toLowerCase();
      const score = text.startsWith(lower)
        ? 0
        : text.includes(lower)
          ? 1
          : approximateMatch(q, text)
            ? 2
            : null;
      if (score !== null) scored.push({ ...candidate, score });
    }
  }
  scored.sort((a, b) => a.score - b.score || a.value.localeCompare(b.value, 'es'));
  for (const item of scored) addSuggestion(out, seen, item);
  return out.slice(0, limit);
}

/** Mejor corrección entre nombres, marcas y categorías conocidas. */
export function didYouMean(query, products) {
  const q = String(query || '').trim();
  if (q.length < 3) return null;
  const queryWords = words(q);
  const candidates = [];
  for (const product of products) {
    candidates.push(product.name, product.category, brandOf(product));
  }
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of new Set(candidates)) {
    const knownWords = words(candidate);
    let typoDistance = Infinity;
    let allWordsKnown = queryWords.length > 0;
    for (const queryWord of queryWords) {
      let wordDistance = Infinity;
      for (const knownWord of knownWords) {
        if (knownWord.length >= 3 && Math.abs(queryWord.length - knownWord.length) <= 3) {
          wordDistance = Math.min(wordDistance, editDistance(queryWord, knownWord, 3));
        }
      }
      if (wordDistance > 3) allWordsKnown = false;
      if (wordDistance > 0) typoDistance = Math.min(typoDistance, wordDistance);
    }
    const whole = editDistance(q, candidate, 3);
    if (whole > 0 && whole <= 3) typoDistance = Math.min(typoDistance, whole);
    // Todas las palabras deben existir y al menos una debe estar mal escrita.
    if (allWordsKnown && typoDistance <= 3 && typoDistance < bestDistance) {
      best = candidate;
      bestDistance = typoDistance;
    }
  }
  return best;
}

/** Resalta el término buscado sin permitir HTML del producto ni de la query. */
export function highlightMatch(text, query) {
  const value = String(text || '');
  const token = String(query || '')
    .trim()
    .split(/\s+/)
    .find((part) => part.length >= 2);
  if (!token) return esc(value);
  const lower = value.toLowerCase();
  const needle = token.toLowerCase();
  let from = 0;
  let html = '';
  let at = lower.indexOf(needle, from);
  while (at >= 0) {
    html += esc(value.slice(from, at)) + `<mark>${esc(value.slice(at, at + token.length))}</mark>`;
    from = at + token.length;
    at = lower.indexOf(needle, from);
  }
  return html + esc(value.slice(from));
}

/** EAN-13 con dígito verificador; el escáner manual no acepta PLU de 8 dígitos. */
export function isGtin13(value) {
  const raw = String(value || '').replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(raw)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(raw[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(raw[12]);
}

export function productForGtin(products, gtin) {
  if (!isGtin13(gtin)) return null;
  const needle = String(gtin).replace(/[\s-]/g, '');
  return (
    products.find((product) =>
      Object.values(product.skus || {}).some((sku) => sku?.gtin === needle)
    ) || null
  );
}
