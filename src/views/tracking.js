/**
 * UP · Seguimiento de ejemplo con mapa estático (FASE B).
 * Leaflet se sirve desde vendor/leaflet/ por CSP; el fondo es un SVG local.
 * No hay tiles externos, datos reales ni movimiento automático si el usuario
 * prefiere movimiento reducido.
 */
import { esc } from '../utils.js';
import { loadState, updateState } from '../storage.js';
import {
  MAP_BOUNDS,
  SIMULATION_SPEED,
  getDemoTracking,
  pointOnRoute,
  stageAt,
  stageLabels,
  stageStartsSim,
} from '../demo-tracking.js';
import { demoBadge } from './shared.js';

let active = null;

const elementId = (orderId) => `track-map-${String(orderId).replace(/[^A-Za-z0-9_-]/g, '-')}`;

function stageTime(startedAt, simSeconds) {
  if (!startedAt) return '—';
  const date = new Date(startedAt + (simSeconds / SIMULATION_SPEED) * 1000);
  if (!Number.isFinite(date.getTime())) return '—';
  return date.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

export function trackingMarkup(order) {
  const tracking = getDemoTracking(order.id);
  if (!tracking) return '';
  const labels = stageLabels(order);
  const started = !!loadState().tracking[order.id];
  const finished = order.status === 'entregado';

  return `
    <section class="up-tracking" aria-labelledby="tracking-title">
      <div class="up-tracking-head">
        <span class="up-eyebrow">SEGUIMIENTO DE EJEMPLO</span>
        <h2 id="tracking-title">Seguimiento de tu pedido</h2>
        ${demoBadge(true)}
      </div>
      <p class="up-tracking-caption">
        Simulación acelerada ×${SIMULATION_SPEED}. Tienda, ruta, coordenadas y repartidor son ficticios.
        ${
          finished
            ? 'El pedido ya figura como entregado: la línea de tiempo está completada.'
            : 'Puedes iniciar la simulación o avanzar etapa por etapa.'
        }
      </p>
      <div class="up-tracking-toolbar">
        <button type="button" class="up-btn-primary" data-track-start ${started || finished ? 'hidden' : ''}>
          Iniciar simulación
        </button>
        <button type="button" class="up-btn-secondary" data-track-step ${finished ? 'hidden' : ''}>
          Avanzar un paso
        </button>
        <button type="button" class="up-btn-secondary" data-track-reset ${started && !finished ? '' : 'hidden'}>
          Reiniciar
        </button>
      </div>
      <div
        id="${elementId(order.id)}"
        class="up-track-map"
        role="img"
        aria-label="Mapa de ejemplo: ruta desde ${esc(tracking.storeName)} hasta ${esc(tracking.destinationLabel)}"
      ></div>
      <p class="up-track-map-desc">
        Ruta de ejemplo: ${esc(tracking.storeName)} → ${esc(tracking.destinationLabel)}.
        La ubicación del repartidor también se describe en la línea de tiempo.
      </p>
      <div
        class="up-track-progress"
        role="progressbar"
        aria-label="Avance del pedido"
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow="0"
        aria-valuetext="Recibido"
        data-track-progress
      >
        <span data-track-progress-fill></span>
      </div>
      <p class="up-track-status" role="status" aria-live="polite" tabindex="-1" data-track-status>
        Recibido · simulación en espera
      </p>
      <ol class="up-timeline" data-track-timeline>
        ${labels
          .map(
            (label, index) => `
          <li data-stage="${index}">
            <span class="up-timeline-dot" aria-hidden="true"></span>
            <span class="up-timeline-label">${esc(label)}</span>
            <time data-stage-time="${index}">—</time>
          </li>`
          )
          .join('')}
      </ol>
      <p class="up-text-muted">
        Fuente: ${esc(tracking.source)} · estado ${esc(tracking.status)} · sin verificación externa.
      </p>
    </section>`;
}

function makeIcon(L, label, modifier) {
  return L.divIcon({
    className: `up-map-icon up-map-icon--${modifier}`,
    html: `<span>${esc(label)}</span>`,
    iconSize: [124, 24],
    iconAnchor: [62, 12],
    interactive: false,
  });
}

function setStarted(button, visible) {
  if (button) button.hidden = !visible;
}

export function bindTracking(container, order) {
  destroyTracking();
  const tracking = getDemoTracking(order.id);
  if (!tracking) return;

  const L = globalThis.L;
  const mapEl = container.querySelector(`#${elementId(order.id)}`);
  if (!mapEl) return;
  const startBtn = container.querySelector('[data-track-start]');
  const stepBtn = container.querySelector('[data-track-step]');
  const resetBtn = container.querySelector('[data-track-reset]');
  const progress = container.querySelector('[data-track-progress]');
  const progressFill = container.querySelector('[data-track-progress-fill]');
  const status = container.querySelector('[data-track-status]');
  const timeline = [...container.querySelectorAll('[data-stage]')];
  const times = [...container.querySelectorAll('[data-stage-time]')];
  const labels = stageLabels(order);
  const starts = stageStartsSim();
  const finished = order.status === 'entregado';
  const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  let map = null;
  let courier = null;

  if (L && L.map) {
    const center = [
      (MAP_BOUNDS[0][0] + MAP_BOUNDS[1][0]) / 2,
      (MAP_BOUNDS[0][1] + MAP_BOUNDS[1][1]) / 2,
    ];
    map = L.map(mapEl, {
      center,
      zoom: 12,
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
      interactive: false,
    });
    L.imageOverlay('assets/map/demo-map.svg', MAP_BOUNDS, {
      interactive: false,
      alt: 'Mapa abstracto de demostración',
    }).addTo(map);
    L.polyline(tracking.route, {
      color: '#D4AF37',
      weight: 4,
      opacity: 0.9,
      interactive: false,
    }).addTo(map);
    L.marker(tracking.store, {
      icon: makeIcon(L, 'Tienda · ejemplo', 'store'),
      interactive: false,
    }).addTo(map);
    L.marker(tracking.destination, {
      icon: makeIcon(L, 'Destino · ejemplo', 'destination'),
      interactive: false,
    }).addTo(map);
    courier = L.marker(tracking.store, {
      icon: makeIcon(L, 'Repartidor · ejemplo', 'courier'),
      interactive: false,
    }).addTo(map);
    map.fitBounds(MAP_BOUNDS, { padding: [8, 8] });
  } else {
    mapEl.classList.add('up-track-map--unavailable');
    mapEl.textContent =
      'Mapa no disponible en este navegador. La línea de tiempo sigue funcionando.';
  }

  function apply() {
    const stored = loadState().tracking[order.id];
    const now = Date.now();
    const elapsedRealMs = stored ? Math.max(0, now - stored.startedAt) : 0;
    const elapsedSimSeconds = finished ? Infinity : (elapsedRealMs / 1000) * SIMULATION_SPEED;
    const info = finished
      ? {
          index: labels.length - 1,
          progress: 1,
          elapsedSimSeconds: Infinity,
          totalSimSeconds: 300,
          done: true,
        }
      : stageAt(elapsedSimSeconds);
    const overall = info.done ? 1 : info.elapsedSimSeconds / info.totalSimSeconds;
    const percent = Math.round(overall * 100);

    progress?.setAttribute('aria-valuenow', String(percent));
    progress?.setAttribute('aria-valuetext', `${labels[info.index]} · ${percent}%`);
    if (progressFill) progressFill.style.width = `${percent}%`;

    timeline.forEach((item, index) => {
      item.classList.toggle('is-done', index < info.index || info.done);
      item.classList.toggle('is-current', index === info.index && !info.done);
      const current = item.classList.contains('is-current');
      item.setAttribute('aria-current', current ? 'step' : 'false');
    });
    times.forEach((time, index) => {
      time.textContent = stageTime(stored?.startedAt, starts[index]);
    });

    const statusText = info.done
      ? `${labels[labels.length - 1]} · simulación terminada`
      : `${labels[info.index]} · ${Math.round(info.progress * 100)}% de esta etapa`;
    if (status)
      status.textContent =
        reduced && !info.done ? `${statusText}. Usa «Avanzar un paso».` : statusText;

    if (courier) courier.setLatLng(pointOnRoute(tracking.route, info.done ? 1 : overall));
    setStarted(startBtn, !stored && !finished);
    setStarted(resetBtn, !!stored && !finished);
    setStarted(stepBtn, !finished);
  }

  function stopTimer() {
    if (active?.timer) globalThis.clearInterval(active.timer);
    if (active) active.timer = null;
  }

  function startTimer() {
    stopTimer();
    if (finished || reduced || !loadState().tracking[order.id]) return;
    active.timer = globalThis.setInterval(apply, 250);
  }

  active = { map, timer: null, orderId: order.id };

  startBtn?.addEventListener('click', () => {
    updateState((state) => {
      state.tracking[order.id] = { startedAt: Date.now(), isDemo: true };
    });
    apply();
    startTimer();
    startBtn.focus();
  });

  stepBtn?.addEventListener('click', () => {
    const stored = loadState().tracking[order.id];
    const current = stageAt(
      stored ? ((Date.now() - stored.startedAt) / 1000) * SIMULATION_SPEED : 0
    ).index;
    const next = Math.min(starts.length - 1, current + 1);
    updateState((state) => {
      state.tracking[order.id] = {
        startedAt: Date.now() - (starts[next] / SIMULATION_SPEED) * 1000,
        isDemo: true,
      };
    });
    apply();
    stopTimer();
    status?.focus({ preventScroll: true });
  });

  resetBtn?.addEventListener('click', () => {
    updateState((state) => {
      delete state.tracking[order.id];
    });
    apply();
    stopTimer();
    startBtn?.focus();
  });

  apply();
  startTimer();
}

export function destroyTracking() {
  if (!active) return;
  if (active.timer) globalThis.clearInterval(active.timer);
  active.map?.remove?.();
  active = null;
}
