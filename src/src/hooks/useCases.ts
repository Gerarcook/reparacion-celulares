import { useCallback, useEffect, useState } from "react";
import type { Case, Measurement } from "../types";

/**
 * Casos de diagnóstico.
 *
 * El tipo `Case` estaba definido desde el arranque y ningún archivo lo usaba:
 * el historial de mediciones vivía solo en memoria del panel y se perdía al
 * cerrar la app. Un caso es el registro para el técnico: "este equipo no
 * prendía,
 * estos son los valores, esta fue la falla". Sin persistencia, cada diagnóstico
 * empieza de cero.
 *
 * Se guarda en localStorage por la misma razón que el resto del estado: son
 * referencias y mediciones, no archivos pesados.
 */

const STORAGE_KEY = "volfix_cases";

/** Máximo de mediciones guardadas por caso. */
const MAX_MEASUREMENTS_PER_CASE = 500;

/** Máximo de casos conservados; los más viejos se descartan. */
const MAX_CASES = 100;

function load(): Case[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    // Se descartan los casos sin id o sin fecha: no se pueden ordenar ni abrir.
    return parsed.filter(
      (c): c is Case => typeof c?.id === "string" && typeof c?.createdAt === "string"
    );
  } catch {
    // Un localStorage corrupto no debe impedir abrir la app.
    return [];
  }
}

export function useCases() {
  const [cases, setCases] = useState<Case[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    } catch (e) {
      console.error("No se pudieron guardar los casos:", e);
    }
  }, [cases]);

  const createCase = useCallback((input: Omit<Case, "id" | "createdAt" | "updatedAt">) => {
    const now = new Date().toISOString();
    const newCase: Case = {
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };

    setCases((prev) => [newCase, ...prev].slice(0, MAX_CASES));
    return newCase;
  }, []);

  const updateCase = useCallback((id: string, patch: Partial<Case>) => {
    setCases((prev) =>
      prev.map((c) =>
        c.id === id ? { ...c, ...patch, updatedAt: new Date().toISOString() } : c
      )
    );
  }, []);

  const removeCase = useCallback((id: string) => {
    setCases((prev) => prev.filter((c) => c.id !== id));
  }, []);

  /**
   * Agrega mediciones al caso.
   *
   * Se llama con las lecturas que el técnico quiere archivar, no con cada valor
   * del multímetro: archivar toda la medición continua llenaría el
   * localStorage y borraría los casos anteriores.
   */
  const addMeasurements = useCallback((id: string, measurements: Measurement[]) => {
    if (measurements.length === 0) return;

    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        return {
          ...c,
          measurements: [...(c.measurements ?? []), ...measurements].slice(
            -MAX_MEASUREMENTS_PER_CASE
          ),
          updatedAt: new Date().toISOString(),
        };
      })
    );
  }, []);

  const getCasesForSchematic = useCallback(
    (schematicId: string) => cases.filter((c) => c.schematicId === schematicId),
    [cases]
  );

  return {
    cases,
    createCase,
    updateCase,
    removeCase,
    addMeasurements,
    getCasesForSchematic,
  };
}