/**
 * UP · Vista diferida por ruta (FASE U7).
 * Muestra un skeleton accesible mientras se carga el módulo y nunca renders
 * una vista obsoleta si el usuario navegó mientras tanto.
 */
import { errorMarkup, loadingMarkup } from './states.js';
import { parseHash } from './router.js';

let token = 0;

function resolveView(module) {
  if (module?.view) return module.view;
  const found = Object.values(module || {}).find(
    (value) => value && typeof value.render === 'function'
  );
  return found || null;
}

export function lazyView(loader, { title = 'Cargando sección…', cards = 3 } = {}) {
  let cached = null;
  return {
    element: 'view-dynamic',
    render(container, ctx = {}) {
      const mine = ++token;
      container.innerHTML = loadingMarkup({ label: title, cards });
      const pending =
        cached ||
        (cached = loader().catch((error) => {
          cached = null;
          throw error;
        }));
      pending
        .then((module) => {
          if (mine !== token || !container.isConnected) return;
          if (parseHash()?.path !== ctx.path) return;
          const view = resolveView(module);
          if (!view) throw new Error('Vista diferida sin exportación render');
          view.render(container, ctx);
          container.querySelector('[data-view-title], h1')?.focus({ preventScroll: true });
        })
        .catch(() => {
          if (mine !== token || !container.isConnected) return;
          container.innerHTML = errorMarkup({ id: 'lazy-retry' });
          container.querySelector('[data-retry]')?.addEventListener('click', () => {
            cached = null;
            ctx.navigate?.(`#${ctx.path}`);
          });
        });
    },
    destroy() {},
  };
}
