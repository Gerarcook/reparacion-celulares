import { useCallback, useEffect, useState } from "react";
import {
  listenMeasurementEvents,
  pollPorts,
  scanDevices,
  type ConnectionState,
  type DeviceInfo,
  type Measurement,
} from "../utils/tauri";

/** Máximo de mediciones retenidas en memoria. */
const MAX_HISTORY = 500;

/** Cada cuánto se re-chequean los puertos para detectar plugged/unplugged. */
const POLL_INTERVAL_MS = 2000;

interface Options {
  /** Si es `false` el panel no se suscribe a nada. */
  active: boolean;
}

interface State {
  devices: DeviceInfo[];
  selectedPort: string | null;
  connectionState: ConnectionState;
  latest: Measurement | null;
  history: Measurement[];
  error: string | null;
  /** `true` mientras se espera la primera lectura. */
  waiting: boolean;
}

const INITIAL: State = {
  devices: [],
  selectedPort: null,
  connectionState: "disconnected",
  latest: null,
  history: [],
  error: null,
  waiting: false,
};

/**
 * Estado del panel de mediciones.
 *
 * Concentra la suscripción a eventos y el sondeo de puertos, para que el
 * componente no tenga que resolver races entre `listen`, `scan` y los cambios
 * de `selectedPort`.
 */
export function useMeasurements({ active }: Options) {
  const [state, setState] = useState<State>(INITIAL);

  const refreshDevices = useCallback(async () => {
    try {
      const found = await scanDevices();
      setState((prev) => ({ ...prev, devices: found }));
    } catch (e) {
      setState((prev) => ({ ...prev, error: `Error escaneando: ${(e as Error).message}` }));
    }
  }, []);

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    const setup = async () => {
      const unlisten = await listenMeasurementEvents((event) => {
        if (cancelled) return;

        switch (event.event) {
          case "DeviceListChanged":
            setState((prev) => ({ ...prev, devices: event.data }));
            break;

          case "ConnectionStateChanged":
            setState((prev) => ({
              ...prev,
              connectionState: event.data.state,
              // El backend es la fuente de verdad del puerto conectado: si
              // desconectan el cable, la UI se entera sin preguntar.
              selectedPort:
                event.data.state === "connected"
                  ? event.data.port
                  : prev.selectedPort === event.data.port
                    ? null
                    : prev.selectedPort,
              waiting:
                event.data.state === "disconnected" ? false : prev.waiting,
            }));
            break;

          case "MeasurementReceived":
            setState((prev) => ({
              ...prev,
              latest: event.data,
              waiting: false,
              history: [...prev.history.slice(-(MAX_HISTORY - 1)), event.data],
            }));
            break;

          case "Error":
            setState((prev) => ({ ...prev, error: event.data }));
            break;
        }
      });

      if (cancelled) {
        unlisten();
        return;
      }

      await refreshDevices();
      return unlisten;
    };

    const cleanup = setup();

    // `serialport` no expone hotplug en Windows: se sondea y el backend avisa
    // solo si la lista cambió.
    const poller = setInterval(() => {
      if (!cancelled) pollPorts().catch(() => {});
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(poller);
      Promise.resolve(cleanup).then((fn) => fn?.());
    };
  }, [active, refreshDevices]);

  const selectPort = useCallback((port: string | null) => {
    setState((prev) => ({ ...prev, selectedPort: port, latest: null, history: [], error: null }));
  }, []);

  const setError = useCallback((error: string | null) => {
    setState((prev) => ({ ...prev, error }));
  }, []);

  const setConnectionState = useCallback((connectionState: ConnectionState) => {
    setState((prev) => ({ ...prev, connectionState }));
  }, []);

  const startMeasuring = useCallback(() => {
    setState((prev) => ({ ...prev, waiting: true, error: null }));
  }, []);

  const stopMeasuring = useCallback(() => {
    setState((prev) => ({ ...prev, waiting: false, latest: null }));
  }, []);

  const clearHistory = useCallback(() => {
    setState((prev) => ({ ...prev, history: [], latest: null }));
  }, []);

  const clearError = useCallback(() => setState((prev) => ({ ...prev, error: null })), []);

  return {
    ...state,
    refreshDevices,
    selectPort,
    setError,
    setConnectionState,
    startMeasuring,
    stopMeasuring,
    clearHistory,
    clearError,
  };
}