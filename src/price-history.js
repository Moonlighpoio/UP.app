/**
 * UP · Historial de precios (FASE U4). Funciones puras.
 * Si el catálogo trae `priceHistory` real se usa; si no, se genera una serie
 * determinista etiquetada como EJEMPLO a partir del precio referencial. Nunca
 * se presenta una serie inventada como dato real ni como oferta comercial.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ALLOWED_DAYS = Object.freeze([30, 90]);

function seedFrom(id) {
  return String(id || '')
    .split('')
    .reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function realPoints(product, days, now) {
  if (!Array.isArray(product?.priceHistory)) return null;
  const lower = now - (days - 1) * DAY_MS;
  const points = product.priceHistory
    .map((item) => ({
      at: new Date(item.at),
      price: Number(item.price),
    }))
    .filter(
      (item) => !Number.isNaN(item.at.getTime()) && Number.isFinite(item.price) && item.price > 0
    )
    .filter((item) => item.at.getTime() >= lower && item.at.getTime() <= now)
    .sort((a, b) => a.at - b.at)
    .slice(-days)
    .map((item) => ({ date: item.at.toISOString().slice(0, 10), price: Math.round(item.price) }));
  return points.length >= 2 ? points : null;
}

function demoPoints(product, days, now) {
  const prices = Object.values(product?.prices || {}).filter(
    (price) => Number.isFinite(price) && price > 0
  );
  if (!prices.length) return [];
  const base = Math.min(...prices);
  const seed = seedFrom(product.id);
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now - (days - 1 - index) * DAY_MS);
    const wave = Math.sin((index + seed) / 3.1) * 0.055 + Math.cos((index + seed) / 6.7) * 0.025;
    return {
      date: date.toISOString().slice(0, 10),
      price: Math.max(490, Math.round((base * (1 + wave)) / 10) * 10),
    };
  });
}

export function historyFor(product, options = {}) {
  const days = ALLOWED_DAYS.includes(options.days) ? options.days : 30;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const real = realPoints(product, days, now);
  const points = real || demoPoints(product, days, now);
  if (!points.length) {
    return {
      days,
      points: [],
      min: null,
      max: null,
      latest: null,
      isDemo: false,
      lowestInPeriod: false,
      source: 'Sin precios disponibles para este producto.',
    };
  }
  const prices = points.map((point) => point.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const latest = points[points.length - 1].price;
  return {
    days,
    points,
    min,
    max,
    latest,
    isDemo: !real,
    lowestInPeriod: latest === min,
    source: real
      ? 'Serie de precios del catálogo; fechas en formato es-CL.'
      : 'Serie de ejemplo generada desde el precio referencial de UP. No es un historial real ni una oferta comercial.',
  };
}

/** Coordenadas puras para un SVG accesible; sin dependencias ni DOM. */
export function historyChart(history, options = {}) {
  const points = history?.points || [];
  if (points.length < 2) return { line: '', area: '', points: [], minPoint: null, maxPoint: null };
  const width = options.width || 640;
  const height = options.height || 180;
  const pad = options.pad || 24;
  const min = history.min;
  const max = history.max;
  const span = max - min || 1;
  const stepX = (width - pad * 2) / (points.length - 1);
  const coords = points.map((point, index) => ({
    ...point,
    x: pad + index * stepX,
    y: height - pad - ((point.price - min) / span) * (height - pad * 2),
  }));
  const line = coords
    .map((point, i) => `${i ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`)
    .join(' ');
  const area = `${line} L${coords[coords.length - 1].x.toFixed(1)},${height - pad} L${coords[0].x.toFixed(1)},${height - pad} Z`;
  const minPoint = coords.find((point) => point.price === min) || null;
  const maxPoint = coords.find((point) => point.price === max) || null;
  return { line, area, points: coords, minPoint, maxPoint };
}
