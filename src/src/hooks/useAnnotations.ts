import { useCallback, useEffect, useState } from "react";
import type { Annotation } from "../types";

/**
 * Anotaciones por esquemático.
 *
 * Antes vivían en el `useState` del visor, así que se perdían al cambiar de
 * vista. Ahora se persisten en localStorage, indexadas por id de esquemático.
 */

const STORAGE_KEY = "volfix_annotations";

type Store = Record<string, Annotation[]>;

function loadStore(): Store {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return {};
    const parsed = JSON.parse(stored);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function useAnnotations(schematicId: string | undefined) {
  const [store, setStore] = useState<Store>(loadStore);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch (e) {
      console.error("No se pudieron guardar las anotaciones:", e);
    }
  }, [store]);

  const annotations: Annotation[] = schematicId ? (store[schematicId] ?? []) : [];

  const addAnnotation = useCallback(
    (annotation: Annotation) => {
      if (!schematicId) return;
      setStore((prev) => ({
        ...prev,
        [schematicId]: [...(prev[schematicId] ?? []), annotation],
      }));
    },
    [schematicId]
  );

  const updateAnnotation = useCallback(
    (id: string, patch: Partial<Annotation>) => {
      if (!schematicId) return;
      setStore((prev) => ({
        ...prev,
        [schematicId]: (prev[schematicId] ?? []).map((a) =>
          a.id === id ? { ...a, ...patch } : a
        ),
      }));
    },
    [schematicId]
  );

  const removeAnnotation = useCallback(
    (id: string) => {
      if (!schematicId) return;
      setStore((prev) => ({
        ...prev,
        [schematicId]: (prev[schematicId] ?? []).filter((a) => a.id !== id),
      }));
    },
    [schematicId]
  );

  const clearAnnotations = useCallback(() => {
    if (!schematicId) return;
    setStore((prev) => ({ ...prev, [schematicId]: [] }));
  }, [schematicId]);

  return {
    annotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
    clearAnnotations,
  };
}