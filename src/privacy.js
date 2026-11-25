/**
 * UP · Aviso de privacidad local (FASE U7).
 * La analítica es interna: ni correos, ni nombres, ni identificadores de usuario.
 * El aviso se puede volver a abrir desde el pie y desde la ayuda.
 */
import { $ } from './utils.js';
import { loadState, updateState } from './storage.js';
import { closeDialog, openDialog } from './a11y.js';

export const PRIVACY_VERSION = 1;

export function privacyAccepted(state) {
  return state?.privacy?.noticeVersion === PRIVACY_VERSION;
}

export function acceptPrivacy(state, { now = Date.now() } = {}) {
  state.privacy = {
    noticeVersion: PRIVACY_VERSION,
    acceptedAt: new Date(now).toISOString(),
    analytics: true,
  };
  return state.privacy;
}

/** Sincroniza el atributo que decide la visibilidad antes del primer paint. */
function syncPrivacyBanner(pending) {
  document.documentElement.dataset.privacy = pending ? 'pending' : 'accepted';
  const banner = $('privacy-banner');
  if (banner) banner.hidden = !pending;
}

/** Muestra el aviso una vez; «Ver detalles» abre el FAQ sin marcarlo aceptado. */
export function initPrivacyNotice() {
  const banner = $('privacy-banner');
  if (!banner) return;
  syncPrivacyBanner(!privacyAccepted(loadState()));

  $('privacy-accept')?.addEventListener('click', () => {
    updateState((state) => acceptPrivacy(state));
    syncPrivacyBanner(false);
    $('privacy-details')?.focus({ preventScroll: true });
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-open-privacy]')) {
      syncPrivacyBanner(true);
      if (typeof openDialog === 'function' && banner.getAttribute('role') === 'dialog') {
        openDialog(banner, 'privacy-title');
      } else {
        $('privacy-accept')?.focus({ preventScroll: true });
      }
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !banner.hidden && banner.getAttribute('role') === 'dialog') {
      closeDialog(banner);
    }
  });
}
