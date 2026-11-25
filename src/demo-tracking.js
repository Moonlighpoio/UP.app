/**
 * UP · Datos de seguimiento de ejemplo (FASE B).
 * Coordenadas arbitrarias dentro de un recuadro de demostración: NO son
 * ubicaciones reales de tiendas ni domicilios. Todo viaja con isDemo: true,
 * status 'demo' y etiqueta "Ejemplo" en la interfaz.
 */

export const SIMULATION_SPEED = 10;
export const STAGE_DURATIONS_SIM = Object.freeze([90, 90, 120]);

export const MAP_BOUNDS = Object.freeze([
  [-33.48, -70.68],
  [-33.4, -70.56],
]);

const TRACKING = {
  'UP-000123': {
    orderId: 'UP-000123',
    isDemo: true,
    status: 'demo',
    verifiedAt: null,
    sourceUrl: null,
    source: 'UP · simulación (demo)',
    storeName: 'Lider + Jumbo (ejemplo)',
    destinationLabel: 'Dirección de ejemplo',
    courierLabel: 'Repartidor de ejemplo',
    store: [-33.426, -70.612],
    destination: [-33.455, -70.585],
    route: [
      [-33.426, -70.612],
      [-33.438, -70.604],
      [-33.447, -70.594],
      [-33.455, -70.585],
    ],
  },
  'UP-000098': {
    orderId: 'UP-000098',
    isDemo: true,
    status: 'demo',
    verifiedAt: null,
    sourceUrl: null,
    source: 'UP · simulación (demo)',
    storeName: 'Tottus (ejemplo)',
    destinationLabel: 'Dirección de ejemplo',
    courierLabel: 'Repartidor de ejemplo',
    store: [-33.449, -70.64],
    destination: [-33.433, -70.575],
    route: [
      [-33.449, -70.64],
      [-33.442, -70.62],
      [-33.438, -70.598],
      [-33.433, -70.575],
    ],
  },
  'UP-000064': {
    orderId: 'UP-000064',
    isDemo: true,
    status: 'demo',
    verifiedAt: null,
    sourceUrl: null,
    source: 'UP · simulación (demo)',
    storeName: 'Santa Isabel (ejemplo)',
    destinationLabel: 'Retiro en tienda · ejemplo',
    courierLabel: 'Preparación de ejemplo',
    store: [-33.42, -70.6],
    destination: [-33.42, -70.6],
    route: [
      [-33.42, -70.6],
      [-33.424, -70.594],
      [-33.42, -70.6],
    ],
  },
};

export function getDemoTracking(orderId) {
  const item = TRACKING[orderId];
  return item ? JSON.parse(JSON.stringify(item)) : null;
}

export function stageLabels(order) {
  return order?.deliveryMode === 'retiro'
    ? ['Recibido', 'Preparando', 'Listo para retiro', 'Entregado']
    : ['Recibido', 'Preparando', 'En camino', 'Entregado'];
}

/** Devuelve el índice de etapa y el avance dentro de ella (0..1). */
export function stageAt(elapsedSimSeconds) {
  const total = STAGE_DURATIONS_SIM.reduce((sum, value) => sum + value, 0);
  const elapsed = Math.max(0, Math.min(total, elapsedSimSeconds));
  if (elapsed >= total) {
    return {
      index: STAGE_DURATIONS_SIM.length,
      progress: 1,
      elapsedSimSeconds: elapsed,
      totalSimSeconds: total,
      done: true,
    };
  }
  let start = 0;
  for (let index = 0; index < STAGE_DURATIONS_SIM.length; index += 1) {
    const duration = STAGE_DURATIONS_SIM[index];
    if (elapsed < start + duration || index === STAGE_DURATIONS_SIM.length - 1) {
      return {
        index,
        progress: Math.max(0, Math.min(1, (elapsed - start) / duration)),
        elapsedSimSeconds: elapsed,
        totalSimSeconds: total,
        done: elapsed >= total,
      };
    }
    start += duration;
  }
  return { index: 3, progress: 1, elapsedSimSeconds: elapsed, totalSimSeconds: total, done: true };
}

export function stageStartsSim() {
  const starts = [0];
  let total = 0;
  for (const duration of STAGE_DURATIONS_SIM) {
    total += duration;
    starts.push(total);
  }
  return starts;
}

function distance(a, b) {
  const dx = (b[1] - a[1]) * Math.cos((((a[0] + b[0]) / 2) * Math.PI) / 180);
  const dy = b[0] - a[0];
  return Math.hypot(dx, dy);
}

/** Interpola un punto sobre la ruta según avance global (0..1). */
export function pointOnRoute(route, progress) {
  if (!Array.isArray(route) || route.length === 0) return null;
  if (route.length === 1) return route[0];
  const segments = [];
  let total = 0;
  for (let index = 0; index < route.length - 1; index += 1) {
    const length = distance(route[index], route[index + 1]);
    segments.push(length);
    total += length;
  }
  if (!total) return route[0];
  let target = Math.max(0, Math.min(1, progress)) * total;
  for (let index = 0; index < segments.length; index += 1) {
    if (target <= segments[index] || index === segments.length - 1) {
      const ratio = segments[index] ? Math.max(0, Math.min(1, target / segments[index])) : 1;
      const from = route[index];
      const to = route[index + 1];
      return [from[0] + (to[0] - from[0]) * ratio, from[1] + (to[1] - from[1]) * ratio];
    }
    target -= segments[index];
  }
  return route[route.length - 1];
}
