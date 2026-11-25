/** Vistas reservadas para fases posteriores: evitan 404 en el router. */
const make = (title, message) => ({
  element: 'view-dynamic',
  render(container) {
    container.innerHTML = `
      <section class="up-view-section up-container">
        <span class="up-eyebrow">PRÓXIMAMENTE</span>
        <h1 data-view-title tabindex="-1">${title}</h1>
        <p>${message}</p>
        <p><a class="up-btn-primary" href="#/">Volver al inicio</a></p>
      </section>`;
  },
  destroy() {},
});

export const offersPlaceholder = make(
  'Ofertas',
  'Las ofertas y eventos verificados se mostrarán cuando se carguen los datos con su fuente.'
);
export const cardsPlaceholder = make(
  'Tarjetas con descuento',
  'UP informará beneficios verificados; nunca pedirá datos de tarjetas.'
);
export const storesPlaceholder = make(
  'Tiendas y mapa',
  'El mapa con distancias aproximadas estará disponible en la siguiente fase.'
);
export const checkoutPlaceholder = make('Pago', 'Preparando el pago simulado…');
