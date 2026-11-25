/**
 * UP · Instalación PWA, estado de conexión y aviso offline (FASE U6).
 * Registra el service worker del mismo origen. No pide permisos ni envía datos.
 */
import { $ } from './utils.js';
import { updateState } from './storage.js';
import { trackEvent } from './analytics.js';

const pwa = {
  supported: false,
  registration: null,
  installEvent: null,
  installable: false,
  offlineNotified: false,
};

function setBanner(online) {
  const banner = $('offline-banner');
  if (!banner) return;
  banner.hidden = online;
  const installButton = $('pwa-install-btn');
  if (installButton) installButton.hidden = !pwa.installable;
}

function reportOffline() {
  if (pwa.offlineNotified) return;
  pwa.offlineNotified = true;
  updateState((state) => trackEvent(state, 'offline_view', { demo: true }));
}

export function getPWAState() {
  return {
    supported: pwa.supported,
    installed: !!pwa.registration?.active && !pwa.installable,
    installable: pwa.installable,
    online: navigator.onLine !== false,
  };
}

/** Muestra el prompt nativo cuando el navegador lo ofrece; nunca lo simula. */
export async function promptInstall() {
  if (!pwa.installEvent) return false;
  const event = pwa.installEvent;
  pwa.installEvent = null;
  pwa.installable = false;
  event.prompt();
  const choice = await event.userChoice.catch(() => ({ outcome: 'dismissed' }));
  setBanner(navigator.onLine !== false);
  return choice?.outcome === 'accepted';
}

export function initPWA() {
  pwa.supported =
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    ['https:', 'http:'].includes(globalThis.location?.protocol || '');

  setBanner(navigator.onLine !== false);

  globalThis.addEventListener?.('online', () => {
    pwa.offlineNotified = false;
    setBanner(true);
  });
  globalThis.addEventListener?.('offline', () => {
    reportOffline();
    setBanner(false);
  });
  if (navigator.onLine === false) reportOffline();

  globalThis.addEventListener?.('beforeinstallprompt', (event) => {
    event.preventDefault();
    pwa.installEvent = event;
    pwa.installable = true;
    setBanner(navigator.onLine !== false);
  });
  globalThis.addEventListener?.('appinstalled', () => {
    pwa.installEvent = null;
    pwa.installable = false;
    updateState((state) => trackEvent(state, 'pwa_install', { demo: true }));
    setBanner(navigator.onLine !== false);
  });

  $('pwa-install-btn')?.addEventListener('click', () => {
    promptInstall().then((accepted) => {
      if (!accepted) setBanner(navigator.onLine !== false);
    });
  });

  if (!pwa.supported) return Promise.resolve(null);

  // El precache del SW no debe competir con el LCP de la primera carga.
  const register = () =>
    navigator.serviceWorker
      .register('./sw.js', { scope: './' })
      .then((registration) => {
        pwa.registration = registration;
        return registration;
      })
      .catch(() => null);

  if (globalThis.requestIdleCallback) {
    globalThis.requestIdleCallback(register, { timeout: 4000 });
  } else {
    globalThis.setTimeout(register, 2000);
  }
  return Promise.resolve(null);
}
