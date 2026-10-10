/**
 * Traducción entre coordenadas de página y coordenadas de pantalla en el PDF.
 *
 * Los puntos de prueba se guardan en coordenadas de página, sin zoom. El canvas
 * de pdf.js mide `página × scale`, así que hay que convertir en los dos
 * sentidos. Estas funciones son el único lugar donde se hace: la equivocación
 * no aparece en typecheck ni en el build, solo mirando la pantalla.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Posición de un punto dentro del overlay.
 *
 * Multiplica por `scale` porque el overlay cubre la página ya renderizada: sus
 * coordenadas están en unidades escaladas.
 */
export function toOverlayPosition(pageX: number, pageY: number, scale: number): Point {
  return { x: pageX * scale, y: pageY * scale };
}

/**
 * Página donde hizo clic el técnico.
 *
 * Divide porque el rect del elemento viene en píxeles escalados y lo que se
 * guarda es coordenada de página. Es la inversa de `toOverlayPosition`: una
 * dividiría en el sentido contrario y el punto aparecería desplazado.
 */
export function toPageCoordinate(screenOffsetX: number, screenOffsetY: number, scale: number): Point {
  return { x: screenOffsetX / scale, y: screenOffsetY / scale };
}