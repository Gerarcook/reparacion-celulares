import type { Annotation } from "../types";

/**
 * Helpers compartidos por los dos visores.
 *
 * Antes vivían sueltos dentro de `ImageViewer`. El visor de PDF necesita el
 * mismo formato y la misma comparación de rango, y duplicarlas haría que las
 * dos vistas mostraran el mismo dato de forma distinta.
 */

/** Redondea a 4 decimales y quita los ceros sobrantes. */
export function formatReading(value: number): string {
  if (!Number.isFinite(value)) return "OL";
  return String(Number(value.toFixed(4)));
}

/**
 * Decide si una lectura está fuera del rango esperado del punto.
 *
 * Con solo `min` o solo `max` la comparación es de una vía: el rango abierto
 * no acota por el lado que falta, como haría un instrumento.
 */
export function isOutOfRange(annotation: Annotation, value: number): boolean {
  const { min, max } = annotation.expected ?? {};
  if (min == null && max == null) return false;
  if (min != null && value < min) return true;
  if (max != null && value > max) return true;
  return false;
}

/** Formatea el rango esperado de un punto para la lista lateral. */
export function describeRange(annotation: Annotation): string {
  const { min, max, unit } = annotation.expected ?? {};
  const u = unit ?? "";
  if (min != null && max != null) return `${formatReading(min)}–${formatReading(max)}${u}`;
  if (min != null) return `≥ ${formatReading(min)}${u}`;
  if (max != null) return `≤ ${formatReading(max)}${u}`;
  return u;
}

/** Un punto sin rango es indistinguible de uno recién creado. */
export function hasExpectedRange(annotation: Annotation): boolean {
  const { min, max, unit } = annotation.expected ?? {};
  return min != null || max != null || (unit != null && unit !== "");
}

/**
 * Interpreta un campo de texto del formulario de rango.
 *
 * Devuelve `undefined` para cadena vacía en vez de `NaN`: `NaN` en el rango
 * rompe la comparación de `isOutOfRange` en silencio, porque toda comparación
 * con `NaN` da `false` y el punto nunca se marcaría como fuera de rango.
 */
export function parseRangeBound(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}