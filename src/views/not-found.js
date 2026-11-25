/** Estado 404 con la misma estética del resto de vistas. */
export const notFoundView = {
  element: 'view-dynamic',
  render(container) {
    container.innerHTML = `
      <section class="up-view-section up-container">
        <span class="up-eyebrow">ERROR 404</span>
        <h1 data-view-title tabindex="-1">Esta página no existe</h1>
        <p>Revisa el enlace o vuelve al catálogo para seguir comparando.</p>
        <p><a class="up-btn-primary" href="#/">Volver al inicio</a></p>
      </section>`;
  },
  destroy() {},
};
