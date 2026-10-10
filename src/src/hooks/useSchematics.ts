import { useCallback, useEffect, useState } from "react";
import type { Schematic } from "../types";

const STORAGE_KEY = "volfix_schematics";

/** Lee la lista persistida, tolerando datos corruptos. */
function load(): Schematic[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];

    // Se descartan las entradas sin path: no se pueden volver a abrir.
    return parsed.filter(
      (s): s is Schematic => typeof s?.id === "string" && typeof s?.filePath === "string"
    );
  } catch {
    // Un localStorage corrupto no debe impedir abrir la app.
    return [];
  }
}

/**
 * Esquemáticos cargados por el técnico.
 *
 * Se persiste solo la referencia al archivo: los PDF pueden pesar cientos de
 * MB y no caben en localStorage.
 */
export function useSchematics() {
  const [schematics, setSchematics] = useState<Schematic[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(schematics));
    } catch (e) {
      console.error("No se pudo guardar el historial:", e);
    }
  }, [schematics]);

  const addSchematic = useCallback((schematic: Schematic) => {
    setSchematics((prev) => {
      // Cargar dos veces el mismo archivo no debe duplicar la entrada.
      const exists = prev.some(
        (s) => s.filePath.toLowerCase() === schematic.filePath.toLowerCase()
      );
      return exists ? prev : [schematic, ...prev];
    });
  }, []);

  const updateSchematic = useCallback((id: string, patch: Partial<Schematic>) => {
    setSchematics((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, []);

  const removeSchematic = useCallback((id: string) => {
    setSchematics((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const getSchematic = useCallback(
    (id: string) => schematics.find((s) => s.id === id),
    [schematics]
  );

  const clearAll = useCallback(() => setSchematics([]), []);

  return {
    schematics,
    addSchematic,
    updateSchematic,
    removeSchematic,
    getSchematic,
    clearAll,
  };
}