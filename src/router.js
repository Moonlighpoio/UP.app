/**
 * UP · Router por hash compatible con GitHub Pages (FASE A).
 * Las rutas con guardia de sesión redirigen a #/login?next=<ruta> y vuelven
 * a esa ruta después de iniciar sesión, sin tocar el carrito.
 */

import { errorMarkup } from './states.js';

export function parseHash(hash = globalThis.location?.hash || '') {
  const raw = String(hash || '').replace(/^#/, '');
  // Anclas internas (#catalogo, #top) no son rutas: las deja el navegador.
  if (!raw || !raw.startsWith('/')) return null;
  const question = raw.indexOf('?');
  const pathPart = question === -1 ? raw : raw.slice(0, question);
  const queryPart = question === -1 ? '' : raw.slice(question + 1);
  const path = pathPart.length > 1 ? pathPart.replace(/\/+$/, '') : pathPart;
  return { path, query: new URLSearchParams(queryPart), raw };
}

export function matchRoute(routes, path) {
  for (const route of routes) {
    if (route.path === '*') continue;
    const names = [];
    const pattern = route.path.replace(/:([A-Za-z0-9_]+)/g, (_, name) => {
      names.push(name);
      return '([^/]+)';
    });
    const match = new RegExp(`^${pattern}$`).exec(path);
    if (match) {
      const params = {};
      names.forEach((name, index) => {
        try {
          params[name] = decodeURIComponent(match[index + 1]);
        } catch {
          params[name] = match[index + 1];
        }
      });
      return { route, params };
    }
  }
  const fallback = routes.find((route) => route.path === '*');
  return { route: fallback || null, params: {} };
}

export function requiresSession(path) {
  return path.startsWith('/cuenta') || path === '/checkout';
}

export function loginTarget(pathWithQuery) {
  return `#/login?next=${encodeURIComponent('#' + pathWithQuery)}`;
}

/** Transición breve entre vistas; nunca se aplica a la carga inicial. */
export const VIEW_TRANSITION_MS = 180;

export function viewTransitionAllowed(reducedMotion, firstRender) {
  return !reducedMotion && !firstRender;
}

export function createRouter({ routes, getSession, onBefore = () => {}, onAfter = () => {} }) {
  let current = null;
  let started = false;
  let hasRendered = false;
  let activeAnimation = null;

  function focusView(el, enabled) {
    if (!enabled) return;
    const candidates = [...el.querySelectorAll('[data-view-title], h1')];
    const visible = candidates.find((node) => !node.closest('[hidden]'));
    const target = visible || candidates[0] || el;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
    globalThis.scrollTo?.({ top: 0, behavior: 'auto' });
  }

  function setMeta(name, content) {
    const meta = document.querySelector(`meta[name="${name}"]`);
    if (meta) meta.setAttribute('content', content || '');
  }

  function animateView(el) {
    activeAnimation?.cancel?.();
    activeAnimation = null;
    const reduced = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!viewTransitionAllowed(reduced, !hasRendered)) return;
    if (typeof el.animate !== 'function') return;
    const animation = el.animate(
      [
        { opacity: 0.65, transform: 'translateY(6px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: VIEW_TRANSITION_MS, easing: 'ease-out' }
    );
    activeAnimation = animation;
    animation.finished
      .then(() => {
        if (activeAnimation !== animation) return;
        animation.cancel();
        activeAnimation = null;
      })
      .catch(() => {
        // Cancelada por una navegación más reciente.
      });
  }

  function handle() {
    const parsed = parseHash();
    if (!parsed) return null;

    const { path, query } = parsed;
    const { route, params } = matchRoute(routes, path);
    if (!route) return null;

    const pathWithQuery = path + (query.toString() ? `?${query}` : '');
    if (requiresSession(path) && !getSession()) {
      const target = loginTarget(pathWithQuery);
      if (globalThis.location.hash !== target) {
        globalThis.history.replaceState(null, '', target);
      }
      return handle();
    }

    onBefore({ path, query, params });
    if (current && current !== route.view) current.destroy?.();

    const el = document.getElementById(route.element || 'view-dynamic');
    if (!el) return null;
    document.querySelectorAll('[data-view]').forEach((node) => {
      if (route.preserve && node === el) return;
      node.hidden = true;
    });
    if (route.element !== 'view-home' && !route.preserve) el.innerHTML = '';
    if (route.seal) {
      // Sólo un shell puede estar activo: retiramos los demás para no dejar
      // contenido obsoleto (y sus escuchas) oculto en el DOM.
      document.querySelectorAll('[data-view-seal]').forEach((node) => {
        if (node.id === route.seal) node.hidden = false;
        else node.remove();
      });
    }
    el.hidden = false;
    current = route.view;

    const ctx = {
      path,
      query,
      params,
      navigate: (hash) => {
        if (globalThis.location.hash === hash) handle();
        else globalThis.location.hash = hash;
      },
    };
    const title = typeof route.title === 'function' ? route.title(params, ctx) : route.title;
    document.title = title || 'UP — Comparador de Supermercados Chile';
    setMeta(
      'description',
      typeof route.description === 'function' ? route.description(params) : route.description
    );
    try {
      route.view.render(el, ctx);
    } catch {
      el.innerHTML = errorMarkup({ id: 'view-retry' });
      el.querySelector('[data-retry]')?.addEventListener('click', () => handle());
    }
    focusView(el, route.focus !== false);
    onAfter(ctx);
    animateView(el);
    hasRendered = true;
    return ctx;
  }

  function navigate(hash) {
    if (globalThis.location.hash === hash) handle();
    else globalThis.location.hash = hash;
  }

  function start() {
    if (started) return;
    started = true;
    if (!globalThis.location.hash) {
      const url = globalThis.location;
      globalThis.history.replaceState(null, '', url.pathname + url.search + '#/');
    }
    globalThis.addEventListener('hashchange', handle);
    handle();
  }

  return { start, handle, navigate };
}
