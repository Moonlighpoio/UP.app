/** Ruta #/ayuda: FAQ con buscador local y contacto simulado (FASE U6). */
import { esc } from '../utils.js';
import { FAQ_ITEMS, filterFaq } from '../faq.js';

function renderList(container, query = '') {
  const items = filterFaq(FAQ_ITEMS, query);
  const list = container.querySelector('#faq-results');
  const count = container.querySelector('#faq-count');
  if (!list) return;
  count.textContent = `${items.length} respuesta${items.length === 1 ? '' : 's'}`;
  list.innerHTML = items.length
    ? items
        .map(
          (item) => `<details class="up-faq-item">
            <summary>${esc(item.question)}</summary>
            <p><span class="up-faq-category">${esc(item.category)}</span> ${esc(item.answer)}</p>
          </details>`
        )
        .join('')
    : '<p class="up-empty-inline">Sin coincidencias. Prueba «precio», «pago» o «datos».</p>';
}

export const helpView = {
  element: 'view-dynamic',
  render(container) {
    container.innerHTML = `
      <section class="up-view-section up-container" aria-labelledby="help-title">
        <span class="up-eyebrow">AYUDA · TEXTO PROPIO DE DEMO</span>
        <h1 id="help-title" data-view-title tabindex="-1">Preguntas frecuentes</h1>
        <p class="up-help-intro">Busca una respuesta. Todo lo que ves aquí es texto de demostración: no es asesoría legal ni atención real.</p>
        <label class="up-help-search" for="faq-search">Buscar en la ayuda</label>
        <input id="faq-search" type="search" placeholder="Ej.: pago, precios, sin conexión" aria-controls="faq-results" />
        <p id="faq-count" class="up-text-muted" aria-live="polite"></p>
        <div id="faq-results" class="up-faq-list"></div>
        <aside class="up-help-contact">
          <h2>Contacto simulado</h2>
          <p>Este prototipo no envía mensajes ni correos. Si necesitas ayuda real, no uses este formulario.</p>
          <button id="contact-demo-btn" type="button" class="up-btn-secondary" aria-expanded="false" aria-controls="contact-demo-note">Mostrar contacto de ejemplo</button>
          <p id="contact-demo-note" class="up-help-note" hidden>
            Correo de ejemplo: <strong>hola@up.cl</strong>. No es una casilla atendida.
            <button type="button" id="copy-example-email" class="up-link-btn">Copiar texto de ejemplo</button>
          </p>
          <a href="#/ayuda/datos" class="up-link-btn">Cómo obtenemos los precios →</a>
        </aside>
      </section>`;
    renderList(container);
    const search = container.querySelector('#faq-search');
    search.addEventListener('input', () => renderList(container, search.value));
    container.querySelector('#contact-demo-btn').addEventListener('click', (event) => {
      const note = container.querySelector('#contact-demo-note');
      note.hidden = !note.hidden;
      event.currentTarget.setAttribute('aria-expanded', String(!note.hidden));
      if (!note.hidden)
        container.querySelector('#copy-example-email')?.focus({ preventScroll: true });
    });
    container.querySelector('#copy-example-email')?.addEventListener('click', async () => {
      try {
        await navigator.clipboard?.writeText('hola@up.cl');
      } catch {
        // Sin permiso de portapapeles: el texto ya está visible para copiar a mano.
      }
    });
  },
};
