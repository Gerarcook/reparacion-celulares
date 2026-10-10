import { describe, expect, it } from "vitest";
import { toOverlayPosition, toPageCoordinate } from "./pdfCoordinates";

/**
 * Matemática del overlay de PDF.
 *
 * Los puntos se guardan en coordenadas de página, pero el canvas de pdf.js mide
 * `página × scale`. Estas dos funciones son el único punto donde se traduce de
 * un sistema al otro, y equivocarse no se ve en typecheck ni en el build: solo
 * se nota mirando la pantalla.
 *
 * Ya se cometió el error una vez: el overlay aplicaba `scale(1/scale)` sobre un
 * canvas que ya venía escalado, o sea una compensación de más. A 100% el factor
 * de error era 1 y no se notaba; a 400% los puntos caían 16 veces lejos del
 * circuito. Estos tests fijan las dos operaciones para que no vuelva.
 */

const ESCALAS = [0.25, 0.5, 1, 1.2, 2, 3, 4];

describe("toOverlayPosition", () => {
  it("a escala 1 el punto cae donde se marcó", () => {
    expect(toOverlayPosition(100, 200, 1)).toEqual({ x: 100, y: 200 });
  });

  it("al acercar el punto se separa del origen proporcionalmente", () => {
    // El esquema se renderiza más grande, así que un punto a 100 px de la
    // esquina queda a 400 px de ella.
    expect(toOverlayPosition(100, 200, 4)).toEqual({ x: 400, y: 800 });
  });

  it("al alejar el punto se acerca al origen proporcionalmente", () => {
    expect(toOverlayPosition(100, 200, 0.25)).toEqual({ x: 25, y: 50 });
  });
});

describe("toPageCoordinate", () => {
  it("devuelve las coordenadas de página de un clic", () => {
    expect(toPageCoordinate(400, 800, 4)).toEqual({ x: 100, y: 200 });
  });
});

describe("ida y vuelta entre los dos sistemas", () => {
  it("marcar y volver a mostrar un punto no deriva en ningún zoom", () => {
    const page = { x: 137.5, y: 892.25 };

    for (const scale of ESCALAS) {
      const shown = toOverlayPosition(page.x, page.y, scale);
      const backAgain = toPageCoordinate(shown.x, shown.y, scale);

      expect(backAgain.x).toBeCloseTo(page.x, 10);
      expect(backAgain.y).toBeCloseTo(page.y, 10);
    }
  });

  // Esta es la propiedad que el técnico percibe: agrandar el esquema no mueve
  // el punto a otro circuito.
  it("el punto sigue en el mismo circuito a cualquier zoom", () => {
    const page = { x: 400, y: 600 };
    const atDouble = toOverlayPosition(page.x, page.y, 2);

    expect(toPageCoordinate(atDouble.x, atDouble.y, 2)).toEqual(page);
  });
});

describe("regresión de la compensación doble", () => {
  it("el error anterior ponía el punto a 1/scale² de su lugar", () => {
    const page = { x: 100, y: 0 };
    const scale = 4;

    const correcto = toOverlayPosition(page.x, page.y, scale);

    // Lo que pasaba con el overlay antiguo: el canvas ya venía escalado por
    // pdf.js, y encima se le aplicaba `scale(1/scale)`. Eso dividía una vez de
    // más, así que el punto quedaba a `página / scale²` de su lugar real.
    const conCompensacionDeMas = toPageCoordinate(correcto.x, correcto.y, scale * scale);

    expect(correcto).toEqual({ x: 400, y: 0 });

    // A escala 1 el error es invisible; a escala 4 el punto quedaba 16x cerca
    // del origen.
    expect(conCompensacionDeMas.x).toBe(25);
    expect(correcto.x / conCompensacionDeMas.x).toBe(16);
  });

  it("a escala 1 la compensación extra no se notaba", () => {
    // Por eso el bug sobrevivió a typecheck, al build y a mirarlo a 100%.
    expect(toOverlayPosition(100, 0, 1).x).toBe(100);
  });
});