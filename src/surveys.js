/**
 * UP · Micro-encuesta de una sola pregunta tras un pedido de prueba (FASE U6).
 * Se guarda en `surveys` con el código de orden de demostración, sin correos,
 * nombres ni datos de pago. Un clic = una respuesta por orden.
 */
import { trackEvent } from './analytics.js';

export const SURVEY_RATINGS = Object.freeze([1, 2, 3, 4, 5]);

export function hasSurveyFor(state, orderId) {
  if (!orderId) return false;
  return (Array.isArray(state?.surveys) ? state.surveys : []).some(
    (item) => item?.orderId === orderId
  );
}

/** Devuelve la encuesta creada o null si la orden ya fue evaluada. */
export function submitSurvey(state, input = {}, { now = Date.now() } = {}) {
  const orderId = String(input.orderId || '').trim();
  const rating = Number(input.rating);
  if (!orderId || !SURVEY_RATINGS.includes(rating) || hasSurveyFor(state, orderId)) return null;

  const survey = {
    id: `survey_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    orderId,
    rating,
    at: new Date(now).toISOString(),
    isDemo: true,
  };
  state.surveys = [...(Array.isArray(state.surveys) ? state.surveys : []), survey].slice(-200);
  trackEvent(state, 'survey_submit', { rating, demo: true });
  return survey;
}

/** Promedio simple, con una sola cifra decimal y sin ordenar por persona. */
export function surveyAverage(surveys = []) {
  const ratings = (Array.isArray(surveys) ? surveys : [])
    .map((item) => Number(item?.rating))
    .filter((value) => SURVEY_RATINGS.includes(value));
  if (!ratings.length) return null;
  return Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10;
}
