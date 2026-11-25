/** Registro de prueba (#/registro): contraseña hasheada y términos explícitos. */
import { updateStateAsync } from '../storage.js';
import { passwordStrength, registerUser } from '../auth.js';
import { accountNotice, clearFormErrors, showFormErrors, updateAuthLinks } from './shared.js';
import { showToast } from '../ui.js';

export const registerView = {
  element: 'view-dynamic',
  render(container, ctx) {
    const next = ctx.query.get('next') || '#/cuenta';
    container.innerHTML = `
      <section class="up-auth-wrap up-container">
        ${accountNotice()}
        <div class="up-auth-card">
          <span class="up-eyebrow">CREAR CUENTA DE PRUEBA</span>
          <h1 data-view-title tabindex="-1">Regístrate</h1>
          <p>Solo para probar el flujo de compra. No uses tus datos reales.</p>
          <form id="register-form" novalidate>
            <label class="up-field">
              <span>Nombre</span>
              <input name="name" type="text" autocomplete="name" placeholder="Nombre de prueba" />
            </label>
            <label class="up-field">
              <span>Correo</span>
              <input name="email" type="email" autocomplete="username" placeholder="prueba@ejemplo.cl" />
            </label>
            <label class="up-field">
              <span>Contraseña (mínimo 8 caracteres)</span>
              <input name="password" type="password" autocomplete="new-password" aria-describedby="password-strength" />
            </label>
            <div id="password-strength" class="up-strength" data-level="weak" role="status" aria-live="polite">
              <span class="up-strength-bar" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              <span class="up-strength-label">Escribe una contraseña</span>
            </div>
            <label class="up-check-field">
              <input name="terms" type="checkbox" value="yes" />
              <span>Acepto los términos de prueba y entiendo que mis datos se guardan sólo en este navegador.</span>
            </label>
            <button type="submit" class="up-btn-primary up-btn-block">Crear cuenta</button>
          </form>
          <p class="up-auth-foot">¿Ya tienes cuenta? <a href="#/login?next=${encodeURIComponent(next)}">Ingresa</a></p>
          <p class="up-auth-foot"><a href="#/">Volver al catálogo</a></p>
        </div>
        <p class="up-sr-only" aria-live="polite" id="register-status"></p>
      </section>`;

    const form = container.querySelector('#register-form');
    const status = container.querySelector('#register-status');
    const password = form.elements.password;
    const strength = container.querySelector('#password-strength');
    const strengthLabel = strength.querySelector('.up-strength-label');

    password.addEventListener('input', () => {
      const info = passwordStrength(password.value);
      strength.dataset.level = info.level;
      strengthLabel.textContent = password.value
        ? `Fortaleza: ${info.label}`
        : 'Escribe una contraseña';
    });

    form.onsubmit = async (event) => {
      event.preventDefault();
      clearFormErrors(form);
      const input = {
        name: form.elements.name.value,
        email: form.elements.email.value,
        password: form.elements.password.value,
        terms: form.elements.terms.checked,
      };
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Guardando…';
      try {
        const result = await updateStateAsync((state) => registerUser(state, input));
        if (!result.ok) {
          showFormErrors(form, result.errors);
          status.textContent = 'Revisa los campos marcados.';
          return;
        }
        form.reset();
        strength.dataset.level = 'weak';
        strengthLabel.textContent = 'Escribe una contraseña';
        updateAuthLinks();
        showToast('Cuenta de prueba creada');
        globalThis.location.hash = next.startsWith('#/') ? next : '#/cuenta';
      } catch (error) {
        status.textContent = error?.message || 'No se pudo crear la cuenta.';
        showToast('No se pudo guardar la cuenta en este navegador');
      } finally {
        button.disabled = false;
        button.textContent = 'Crear cuenta';
      }
    };
  },
  destroy() {},
};
