/** Ruta #/checkout: abre el asistente existente sin alterar su matemática. */
import { startCheckout } from '../checkout.js';
import { closeCheckoutModal } from '../ui.js';

export const checkoutView = {
  element: 'view-dynamic',
  _onClose: null,
  render(container) {
    container.innerHTML = `
      <section class="up-view-section up-container">
        <span class="up-eyebrow">PAGO SIMULADO</span>
        <h1 data-view-title tabindex="-1">Confirmar tu compra</h1>
        <p>El asistente de pago se abre a continuación. No se solicitan datos de tarjeta.</p>
      </section>`;

    const goHome = () => {
      if (globalThis.location.hash === '#/checkout') {
        globalThis.setTimeout(() => {
          if (globalThis.location.hash === '#/checkout') globalThis.location.hash = '#/';
        }, 0);
      }
    };
    this._onClose = (event) => {
      if (event.type === 'keydown' && event.key !== 'Escape') return;
      const modal = document.getElementById('checkout-modal');
      if (modal && modal.classList.contains('hidden')) goHome();
    };
    document.getElementById('close-checkout-modal')?.addEventListener('click', this._onClose);
    document.getElementById('finish-order-btn')?.addEventListener('click', this._onClose);
    document.addEventListener('keydown', this._onClose);
    startCheckout();
  },
  destroy() {
    const handler = this._onClose;
    if (handler) {
      document.getElementById('close-checkout-modal')?.removeEventListener('click', handler);
      document.getElementById('finish-order-btn')?.removeEventListener('click', handler);
      document.removeEventListener('keydown', handler);
    }
    this._onClose = null;
    closeCheckoutModal();
  },
};
