/**
 * UP · Sesión de prueba (FASE A), 100% local.
 * La contraseña nunca se guarda en texto plano: PBKDF2-SHA256 con sal de 16
 * bytes. El token de sesión es aleatorio y expira a los 7 días.
 * En producción se requiere backend con bcrypt/argon2, HTTPS y consentimiento
 * conforme a la Ley 19.628; este módulo es sólo demostración.
 */

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PBKDF2_ITERATIONS = 150000;
const SALT_BYTES = 16;

function subtle() {
  const crypto = globalThis.crypto;
  if (!crypto || !crypto.subtle) {
    throw new Error('La API criptográfica no está disponible (usa HTTPS o localhost).');
  }
  return crypto;
}

function toBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return globalThis.btoa(binary);
}

function fromBase64(value) {
  return Uint8Array.from(globalThis.atob(value), (char) => char.charCodeAt(0));
}

function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function validateEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function passwordStrength(password) {
  const value = String(password || '');
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  const level = score <= 1 ? 'weak' : score <= 3 ? 'fair' : score === 4 ? 'good' : 'strong';
  const labels = { weak: 'Baja', fair: 'Media', good: 'Alta', strong: 'Muy alta' };
  return { score, level, label: labels[level] };
}

export function validateRegistration({ name, email, password, terms } = {}) {
  const errors = [];
  if (typeof name !== 'string' || name.trim().length < 2) {
    errors.push({ field: 'name', message: 'Escribe tu nombre (al menos 2 caracteres).' });
  }
  if (!validateEmail(email)) {
    errors.push({
      field: 'email',
      message: 'Escribe un correo válido, por ejemplo prueba@ejemplo.cl.',
    });
  }
  if (typeof password !== 'string' || password.length < 8) {
    errors.push({ field: 'password', message: 'La contraseña debe tener al menos 8 caracteres.' });
  }
  if (terms !== true) {
    errors.push({ field: 'terms', message: 'Debes aceptar los términos de prueba.' });
  }
  return errors;
}

export function validateLogin({ email, password } = {}) {
  const errors = [];
  if (!validateEmail(email)) {
    errors.push({ field: 'email', message: 'Escribe un correo válido.' });
  }
  if (typeof password !== 'string' || !password.length) {
    errors.push({ field: 'password', message: 'Escribe tu contraseña.' });
  }
  return errors;
}

/** Deriva 256 bits con PBKDF2. `salt` se usa sólo para verificar. */
export async function hashPassword(password, { salt, iterations = PBKDF2_ITERATIONS } = {}) {
  const crypto = subtle();
  const saltBytes = salt ? fromBase64(salt) : crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await crypto.subtle.importKey(
    'raw',
    new globalThis.TextEncoder().encode(String(password)),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return {
    algorithm: 'PBKDF2-SHA256',
    salt: toBase64(saltBytes),
    hash: toBase64(new Uint8Array(bits)),
    iterations,
  };
}

export async function verifyPassword(password, record) {
  if (!record || !record.salt || !record.hash) return false;
  const derived = await hashPassword(password, {
    salt: record.salt,
    iterations: record.iterations || PBKDF2_ITERATIONS,
  });
  return constantTimeEqual(derived.hash, record.hash);
}

function randomToken(bytes = 24) {
  const crypto = subtle();
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export function createSession(userId, { now = Date.now, ttlMs = SESSION_TTL_MS } = {}) {
  const current = typeof now === 'function' ? now() : now;
  return {
    token: globalThis.crypto?.randomUUID?.() || randomToken(24),
    userId,
    createdAt: new Date(current).toISOString(),
    expiresAt: new Date(current + ttlMs).toISOString(),
  };
}

export function isSessionValid(session, { now = Date.now } = {}) {
  if (!session || typeof session.token !== 'string' || !session.userId) return false;
  const expires = Date.parse(session.expiresAt);
  const current = typeof now === 'function' ? now() : now;
  return Number.isFinite(expires) && Number.isFinite(current) && expires > current;
}

export function sessionUser(state) {
  if (!isSessionValid(state?.session)) return null;
  return state.users.find((user) => user.id === state.session.userId) || null;
}

/** Mutamos el estado ya leído por storage.updateState; el guardado lo hace el llamador. */
export async function registerUser(state, input) {
  const errors = validateRegistration(input);
  if (errors.length) return { ok: false, errors };

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (state.users.some((user) => user.email === email)) {
    return {
      ok: false,
      errors: [{ field: 'email', message: 'Ese correo ya está registrado en este navegador.' }],
    };
  }

  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  const user = {
    id: `usr_${randomToken(8)}`,
    name,
    email,
    passwordHash,
    createdAt: now,
    termsAcceptedAt: now,
    isDemo: false,
  };
  state.users.push(user);
  state.session = createSession(user.id);
  state.profile = { name, email };
  return { ok: true, user, session: state.session };
}

export async function loginUser(state, input) {
  const errors = validateLogin(input);
  if (errors.length) return { ok: false, errors };

  const email = input.email.trim().toLowerCase();
  const user = state.users.find((candidate) => candidate.email === email);
  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    return {
      ok: false,
      errors: [{ field: 'password', message: 'Correo o contraseña incorrectos.' }],
    };
  }
  state.session = createSession(user.id);
  state.profile = { name: user.name, email: user.email };
  return { ok: true, user, session: state.session };
}

export function logoutUser(state) {
  state.session = null;
  return { ok: true };
}
