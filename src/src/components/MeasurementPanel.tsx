import { useCallback, useState } from "react";
import {
  connectDevice,
  disconnectDevice,
  setMeasurementMode,
  startMeasurement,
  stopMeasurement,
  readSingleMeasurement,
  type DeviceInfo,
  type MeasurementMode,
} from "../utils/tauri";
import type { useMeasurements } from "../hooks/useMeasurements";
import "./MeasurementPanel.css";

/** Todo lo que `useMeasurements` devuelve, para no instanciarlo dos veces. */
type MeasurementsState = ReturnType<typeof useMeasurements>;

interface MeasurementPanelProps {
  isOpen: boolean;
  onClose: () => void;
  /**
   * El estado de las mediciones vive en `App`, no acá.
   *
   * El historial se archiva en casos, y un caso vive junto al esquemático: si
   * el estado se quedara en este panel, `App` no podría leerlo y el archivado
   * solo sería posible con el panel abierto.
   */
  measurements: MeasurementsState;
}

const MODE_LABELS: Record<MeasurementMode, string> = {
  voltage_dc: "V DC",
  voltage_ac: "V AC",
  current_dc: "A DC",
  current_ac: "A AC",
  resistance: "Ω",
  continuity: "Continuidad",
  diode: "Diodo",
  capacitance: "Capacitancia",
  frequency: "Frecuencia",
  temperature: "Temp",
  duty_cycle: "Duty %",
  unknown: "Desconocido",
};

const MODE_ICONS: Record<MeasurementMode, string> = {
  voltage_dc: "⚡",
  voltage_ac: "~",
  current_dc: "⎓",
  current_ac: "∼",
  resistance: "Ω",
  continuity: "🔊",
  diode: "▷|",
  capacitance: "||",
  frequency: "〰",
  temperature: "🌡",
  duty_cycle: "▁▂▃",
  unknown: "?",
};

/** Drivers que se pueden forzar cuando la autodetección falla. */
const MANUAL_DRIVERS: { value: string; label: string }[] = [
  { value: "unit_ut", label: "Uni-T" },
  { value: "aneng", label: "ANENG" },
  { value: "scpi", label: "SCPI" },
];

/** Modos que solo tienen sentido en instrumentos SCPI. */
const SCPI_ONLY_MODES: MeasurementMode[] = [
  "capacitance",
  "frequency",
  "temperature",
  "duty_cycle",
];

export function MeasurementPanel({ isOpen, onClose, measurements }: MeasurementPanelProps) {
  const {
    devices,
    selectedPort,
    connectionState,
    latest,
    history,
    error,
    waiting,
    refreshDevices,
    selectPort,
    setError,
    setConnectionState,
    startMeasuring,
    stopMeasuring,
    clearHistory,
    clearError,
  } = measurements;

  const [currentMode, setCurrentMode] = useState<MeasurementMode>("voltage_dc");
  const [manualDriver, setManualDriver] = useState<string>("");
  const [busyPort, setBusyPort] = useState<string | null>(null);

  const isConnected = connectionState === "connected" && selectedPort != null;
  const selectedDevice = devices.find((d) => d.port === selectedPort);
  const isScpi = selectedDevice?.driver_type === "scpi";

  const handleConnect = useCallback(
    async (device: DeviceInfo, driverOverride?: string) => {
      const driverType = driverOverride ?? device.driver_type;
      setError(null);
      setBusyPort(device.port);
      setConnectionState("connecting");

      try {
        await connectDevice(device.port, driverType);
        selectPort(device.port);
      } catch (e) {
        setError((e as Error).message);
        setConnectionState("error");
      } finally {
        setBusyPort(null);
      }
    },
    [selectPort, setError, setConnectionState]
  );

  const handleDisconnect = useCallback(
    async (port: string) => {
      setError(null);
      try {
        await disconnectDevice(port);
        selectPort(null);
        setConnectionState("disconnected");
        stopMeasuring();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [selectPort, setConnectionState, stopMeasuring, setError]
  );

  const handleStart = useCallback(async () => {
    if (!selectedPort) return;
    setError(null);

    try {
      await startMeasurement(selectedPort);
      startMeasuring();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedPort, startMeasuring, setError]);

  const handleStop = useCallback(async () => {
    if (!selectedPort) return;
    setError(null);

    try {
      await stopMeasurement(selectedPort);
      stopMeasuring();
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedPort, stopMeasuring, setError]);

  const handleReadOnce = useCallback(async () => {
    if (!selectedPort) return;
    setError(null);

    try {
      await readSingleMeasurement(selectedPort);
      // El valor llega por el canal de eventos, no por el return del comando:
      // el backend lo publica siempre por el mismo camino.
    } catch (e) {
      setError((e as Error).message);
    }
  }, [selectedPort, setError]);

  const handleModeChange = useCallback(
    async (mode: MeasurementMode) => {
      setCurrentMode(mode);
      if (!selectedPort) return;
      setError(null);

      try {
        await setMeasurementMode(selectedPort, mode);
      } catch (e) {
        // En Uni-T y ANENG el modo es un selector físico: se avisa sin fallar.
        setError(
          (e as Error).message.includes("selector") || (e as Error).message.includes("físic")
            ? "Este modelo cambia de modo con el selector físico del instrumento."
            : (e as Error).message
        );
      }
    },
    [selectedPort, setError]
  );

  const handleExportCSV = useCallback(() => {
    if (history.length === 0) return;

    const header = "timestamp,iso8601,valor,unidad,modo,relativo,overflow";
    const rows = history.map((m) =>
      [
        m.timestamp,
        new Date(m.timestamp).toISOString(),
        m.is_overflow ? "OL" : m.value,
        m.unit,
        m.mode,
        m.is_relative,
        m.is_overflow,
      ].join(",")
    );

    // El BOM evita que Excel Rompa los acentos de la columna `unidad`.
    const blob = new Blob(["﻿" + [header, ...rows].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `volfix-mediciones-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [history]);

  if (!isOpen) return null;

  return (
    <aside className="measurement-panel" aria-label="Panel de mediciones">
      <div className="panel-header">
        <h3>📊 Mediciones USB</h3>
        <button className="btn-close" onClick={onClose} aria-label="Cerrar panel">
          ×
        </button>
      </div>

      {error && (
        <div className="error-banner" onClick={clearError} role="alert">
          ⚠ {error}
        </div>
      )}

      <section className="panel-section">
        <div className="section-header">
          <h4>Dispositivos detectados</h4>
          <button className="btn-refresh" onClick={refreshDevices} title="Re-escanear">
            ↻
          </button>
        </div>

        {devices.length === 0 ? (
          <p className="empty-state">
            No se detectaron puertos. Conectá el multímetro por USB.
          </p>
        ) : (
          <ul className="device-list">
            {devices.map((device) => (
              <li key={device.port} className="device-item">
                <div className="device-info">
                  <span className="device-port">{device.port}</span>
                  <span className={`device-driver driver-${device.driver_type}`}>
                    {device.driver_type === "unknown"
                      ? "sin driver"
                      : device.driver_type.toUpperCase()}
                  </span>
                </div>

                <div className="device-details">
                  {device.manufacturer && <span>{device.manufacturer}</span>}
                  {device.product && <span>{device.product}</span>}
                </div>

                {device.driver_type === "unknown" ? (
                  <div className="manual-driver">
                    <select
                      value={manualDriver}
                      onChange={(e) => setManualDriver(e.target.value)}
                      aria-label="Elegí el modelo del multímetro"
                    >
                      <option value="">Elegí modelo…</option>
                      {MANUAL_DRIVERS.map((d) => (
                        <option key={d.value} value={d.value}>
                          {d.label}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn-connect"
                      disabled={!manualDriver || busyPort === device.port}
                      onClick={() => handleConnect(device, manualDriver)}
                    >
                      {busyPort === device.port ? "…" : "Conectar"}
                    </button>
                  </div>
                ) : (
                  <button
                    className="btn-connect"
                    onClick={() => handleConnect(device)}
                    disabled={busyPort === device.port || connectionState === "connecting"}
                  >
                    {busyPort === device.port ? "…" : "Conectar"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedPort && (
        <section className="panel-section connected">
          <h4>
            Conectado: {selectedPort}
            <button
              className="btn-disconnect"
              onClick={() => handleDisconnect(selectedPort)}
            >
              Desconectar
            </button>
          </h4>

          <div className="mode-selector">
            <label htmlFor="mode-select">Modo:</label>
            <select
              id="mode-select"
              value={currentMode}
              onChange={(e) => handleModeChange(e.target.value as MeasurementMode)}
            >
              {Object.entries(MODE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {MODE_ICONS[value as MeasurementMode]} {label}
                </option>
              ))}
            </select>
          </div>

          {!isScpi && currentMode !== "unknown" && SCPI_ONLY_MODES.includes(currentMode) && (
            <p className="hint">
              Este modo requiere un instrumento SCPI. En Uni-T y ANENG el modo se
              elige con el selector físico.
            </p>
          )}

          <div className="measurement-controls">
            <button
              className={`btn-measure ${waiting ? "measuring" : ""}`}
              onClick={waiting ? handleStop : handleStart}
              disabled={!isConnected}
            >
              {waiting ? "⏹ Detener" : "▶ Iniciar"}
            </button>
            <button className="btn-single" onClick={handleReadOnce} disabled={!isConnected}>
              ⏱ Una lectura
            </button>
          </div>

          <div className="current-reading">
            {latest ? (
              <>
                <div className="reading-value">
                  {latest.is_overflow ? "OL" : latest.value.toFixed(4)}
                </div>
                <div className="reading-unit">{latest.unit}</div>
                <div className="reading-mode">
                  {MODE_ICONS[latest.mode]} {MODE_LABELS[latest.mode]}
                </div>
                {latest.is_relative && <span className="badge relative">REL</span>}
                {latest.is_overflow && <span className="badge overflow">OL</span>}
              </>
            ) : (
              <div className="reading-placeholder">
                {waiting ? "Esperando datos del instrumento…" : "Sin lecturas"}
              </div>
            )}
          </div>

          <div className="history-section">
            <div className="history-header">
              <h4>Historial ({history.length})</h4>
              <div className="history-actions">
                <button
                  className="btn-small"
                  onClick={handleExportCSV}
                  disabled={history.length === 0}
                >
                  📥 CSV
                </button>
                <button
                  className="btn-small"
                  onClick={clearHistory}
                  disabled={history.length === 0}
                >
                  🗑 Limpiar
                </button>
              </div>
            </div>

            {history.length === 0 ? (
              <p className="empty-state">Sin mediciones aún</p>
            ) : (
              <div className="history-list">
                {history
                  .slice(-20)
                  .reverse()
                  .map((m, idx) => (
                    <div key={`${m.timestamp}-${idx}`} className="history-item">
                      <span className="history-time">
                        {new Date(m.timestamp).toLocaleTimeString()}
                      </span>
                      <span className="history-value">
                        {m.is_overflow ? "OL" : m.value.toFixed(4)} {m.unit}
                      </span>
                      <span className="history-mode">{MODE_ICONS[m.mode]}</span>
                      {m.is_overflow && <span className="badge overflow">OL</span>}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </section>
      )}
    </aside>
  );
}