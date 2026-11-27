/** Inicio de sesión de prueba (#/login). */
import { updateStateAsync } from '../storage.js';
import { DEMO_ACCOUNTS, DEMO_PASSWORD, loginUser } from '../auth.js';
import { ensureDemoAccounts } from '../demo-accounts.js';
import { accountNotice, clearFormErrors, showFormErrors, updateAuthLinks } from './shared.js';
import { showToast } from '../ui.js';

export const loginView = {
  element: 'view-dynamic',
  render(container, ctx) {
    const next = ctx.query.get('next') || '#/cuenta';
    container.innerHTML = `
      <section class="up-auth-wrap up-container">
        ${accountNotice()}
        <p id="demo-account-note" class="up-test-notice" role="status" aria-live="polite">
          Preparando cuentas públicas de prueba…
        </p>
        <div class="up-auth-card">
          <span class="up-eyebrow">ACCESO DE PRUEBA</span>
          <h1 data-view-title tabindex="-1">Ingresa a tu cuenta</h1>
          <p>Explora y arma tu carrito sin cuenta. Para pagar necesitas una sesión de prueba.</p>
          <form id="login-form" novalidate>
            <label class="up-field">
              <span>Correo</span>
              <input name="email" type="email" autocomplete="username" placeholder="prueba@ejemplo.cl" aria-describedby="login-hint" />
            </label>
            <p id="login-hint" class="up-field-hint">Usa un correo de prueba, nunca uno real.</p>
            <label class="up-field">
              <span>Contraseña</span>
              <input name="password" type="password" autocomplete="current-password" />
            </label>
            <div class="up-auth-actions">
              <button type="submit" class="up-btn-primary up-btn-block">Ingresar</button>
              <button type="button" class="up-link-btn" id="forgot-password-btn">¿Olvidé mi contraseña?</button>
            </div>
            <p id="forgot-message" class="up-inline-message" role="status" hidden></p>
          </form>
          <p class="up-auth-foot">¿No tienes cuenta? <a href="#/registro?next=${encodeURIComponent(next)}">Regístrate</a></p>
          <p class="up-auth-foot"><a href="#/">Volver al catálogo</a></p>
        </div>
        <p class="up-sr-only" aria-live="polite" id="login-status"></p>
      </section>`;

    const form = container.querySelector('#login-form');
    const status = container.querySelector('#login-status');
    const forgotBtn = container.querySelector('#forgot-password-btn');
    const forgotMessage = container.querySelector('#forgot-message');
    const demoNote = container.querySelector('#demo-account-note');

    // La siembra es idempotente: el inicio de la app también la dispara.
    const seeded = ensureDemoAccounts();
    seeded
      .then(() => {
        if (!demoNote?.isConnected) return;
        demoNote.innerHTML = `<strong>CUENTAS DEMO</strong><p>${DEMO_ACCOUNTS.map(
          (item) => `${item.role}: ${item.email}`
        ).join(
          ' · '
        )} · contraseña pública <code>${DEMO_PASSWORD}</code>. El panel <a href="#/admin">#/admin</a> es sólo local y NO es seguro.</p>`;
      })
      .catch(() => {
        if (demoNote?.isConnected)
          demoNote.textContent = 'No se pudieron preparar las cuentas demo.';
      });

    form.onsubmit = async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      const input = {
        email: form.elements.email.value,
        password: form.elements.password.value,
      };
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Verificando…';
      try {
        await seeded;
        const result = await updateStateAsync((state) => loginUser(state, input));
        if (!result.ok) {
          showFormErrors(form, result.errors);
          status.textContent = 'No se pudo iniciar sesión.';
          return;
        }
        updateAuthLinks();
        showToast('Sesión de prueba iniciada');
        container.ownerDocument.defaultView.location.hash = next.startsWith('#/')
          ? next
          : '#/cuenta';
      } catch (error) {
        status.textContent = error?.message || 'No se pudo iniciar sesión.';
        showToast('No se pudo iniciar sesión en este navegador');
      } finally {
        button.disabled = false;
        button.textContent = 'Ingresar';
      }
    };

    forgotBtn.onclick = () => {
      forgotMessage.hidden = false;
      forgotMessage.textContent =
        'Modo prueba: no hay recuperación real. Usa un correo de prueba y regístrate de nuevo.';
    };
  },
  destroy() {},
};
