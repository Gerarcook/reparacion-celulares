import { useEffect, useState } from "react";
import { listenMeasurementEvents, type Measurement } from "../utils/tauri";

/**
 * Última medición publicada por el backend.
 *
 * El panel de mediciones mantiene su propio historial; este hook es solo para
 * superponer el valor vivo sobre el punto del esquemático que el técnico está
 * mirando. No guarda historial, así que no duplica memoria.
 *
 * @param active Si es `false` no se suscribe a nada.
 */
export function useLiveMeasurement(active: boolean): Measurement | null {
  const [latest, setLatest] = useState<Measurement | null>(null);

  useEffect(() => {
    if (!active) {
      setLatest(null);
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | undefined;

    listenMeasurementEvents((event) => {
      if (cancelled) return;
      if (event.event === "MeasurementReceived") {
        setLatest(event.data);
      }
    }).then((fn) => {
      // Si el componente se desmontó mientras se registraba el listener,
      // hay que desuscribirse enseguida o queda colgado para siempre.
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [active]);

  return latest;
}