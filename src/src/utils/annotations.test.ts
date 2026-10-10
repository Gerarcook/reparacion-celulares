import { describe, expect, it } from "vitest";
import {
  describeRange,
  formatReading,
  isOutOfRange,
  parseRangeBound,
} from "./annotations";
import type { Annotation } from "../types";

function point(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "a1",
    point: { x: 0, y: 0 },
    label: "TP1",
    color: "#ff6b6b",
    timestamp: "2026-10-10T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseRangeBound", () => {
  it("interpreta un número escrito por el técnico", () => {
    expect(parseRangeBound("3.7")).toBe(3.7);
  });

  it("devuelve undefined en vez de NaN con texto vacío", () => {
    expect(parseRangeBound("")).toBeUndefined();
    expect(parseRangeBound("   ")).toBeUndefined();
  });

  // Este es el caso que motivó el helper: un `NaN` en el rango hace que
  // TODA comparación dé false, así que el punto nunca se marca como fuera de
  // rango. Falso negativo silencioso, justo del lado peligroso.
  it("descarta texto no numérico en vez de devolver NaN", () => {
    expect(parseRangeBound("abc")).toBeUndefined();
    expect(parseRangeBound("3,7")).toBeUndefined();
    expect(parseRangeBound("Infinity")).toBeUndefined();
  });

  it("admite negativos", () => {
    expect(parseRangeBound("-1.5")).toBe(-1.5);
  });
});

describe("isOutOfRange", () => {
  it("sin rango no marca nada", () => {
    expect(isOutOfRange(point(), 999)).toBe(false);
    expect(isOutOfRange(point({ expected: {} }), 999)).toBe(false);
  });

  it("detecta por debajo del mínimo", () => {
    const a = point({ expected: { min: 3.3, max: 3.7 } });
    expect(isOutOfRange(a, 3.0)).toBe(true);
    expect(isOutOfRange(a, 3.5)).toBe(false);
    expect(isOutOfRange(a, 4.0)).toBe(true);
  });

  it("respeta los límites abiertos", () => {
    expect(isOutOfRange(point({ expected: { min: 3.3 } }), 3.2)).toBe(true);
    expect(isOutOfRange(point({ expected: { min: 3.3 } }), 999)).toBe(false);
    expect(isOutOfRange(point({ expected: { max: 3.7 } }), 999)).toBe(true);
    expect(isOutOfRange(point({ expected: { max: 3.7 } }), 0.1)).toBe(false);
  });

  it("acepta los extremos exactos", () => {
    const a = point({ expected: { min: 3.3, max: 3.7 } });
    expect(isOutOfRange(a, 3.3)).toBe(false);
    expect(isOutOfRange(a, 3.7)).toBe(false);
  });
});

describe("describeRange", () => {
  it("usa el signo correcto según los límites presentes", () => {
    expect(describeRange(point({ expected: { min: 3.3, max: 3.7, unit: "V" } }))).toBe(
      "3.3–3.7V"
    );
    expect(describeRange(point({ expected: { min: 3.3, unit: "V" } }))).toBe("≥ 3.3V");
    expect(describeRange(point({ expected: { max: 3.7, unit: "V" } }))).toBe("≤ 3.7V");
  });

  it("devuelve cadena vacía cuando no hay rango", () => {
    // La UI usa esto para distinguir "sin rango" de un rango real.
    expect(describeRange(point())).toBe("");
    expect(describeRange(point({ expected: {} }))).toBe("");
  });
});

describe("formatReading", () => {
  it("quita ceros sobrantes y redondea", () => {
    expect(formatReading(3.70000)).toBe("3.7");
    expect(formatReading(3.123456)).toBe("3.1235");
  });

  it("muestra OL en vez de un número inválido", () => {
    expect(formatReading(NaN)).toBe("OL");
    expect(formatReading(Infinity)).toBe("OL");
  });
});