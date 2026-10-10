import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type {
  Schematic,
  Measurement,
  DeviceInfo,
  ConnectionState,
  MeasurementMode,
  MeasurementEventType,
} from "../types";

export type {
  Schematic,
  Measurement,
  DeviceInfo,
  ConnectionState,
  MeasurementMode,
  MeasurementEventType,
};

/** Extensiones que VolFix sabe mostrar. */
const SCHEMATIC_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "bmp", "webp"];

/* ==================== ESQUEMÁTICOS ==================== */

/**
 * Abre el diálogo nativo y devuelve el esquemático elegido.
 *
 * El archivo no se copia: se guarda la ruta. `convertFileSrc` la convierte al
 * protocolo `asset://` que usa el webview para leer archivos locales.
 */
export async function pickSchematic(): Promise<Schematic | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "Esquemáticos", extensions: SCHEMATIC_EXTENSIONS }],
  });

  if (!selected || Array.isArray(selected)) return null;

  const filePath = selected;
  const fileName = filePath.split(/[\\/]/).pop() || "Sin nombre";
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";

  if (!SCHEMATIC_EXTENSIONS.includes(extension)) {
    throw new Error(`Formato no soportado: .${extension}`);
  }

  return {
    id: crypto.randomUUID(),
    name: fileName.replace(/\.[^.]+$/, ""),
    filePath,
    fileType: extension === "pdf" ? "pdf" : "image",
    // Las fechas viajan como ISO string: localStorage no sabe serializar Date.
    uploadedAt: new Date().toISOString(),
  };
}

/** Convierte una ruta local a una URL que el webview puede leer. */
export function toAssetUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

export async function greet(name: string): Promise<string> {
  return await invoke("greet", { name });
}

/* ==================== USB / MEDICIONES ==================== */

export async function scanDevices(): Promise<DeviceInfo[]> {
  return await invoke("scan_devices");
}

export async function pollPorts(): Promise<void> {
  await invoke("poll_ports");
}

export async function connectDevice(port: string, driverType: string): Promise<void> {
  await invoke("connect_device", { port, driverType });
}

export async function disconnectDevice(port: string): Promise<void> {
  await invoke("disconnect_device", { port });
}

export async function startMeasurement(port: string): Promise<void> {
  await invoke("start_measurement", { port });
}

export async function stopMeasurement(port: string): Promise<void> {
  await invoke("stop_measurement", { port });
}

export async function setMeasurementMode(port: string, mode: MeasurementMode): Promise<void> {
  await invoke("set_measurement_mode", { port, mode });
}

export async function readSingleMeasurement(port: string): Promise<Measurement> {
  return await invoke("read_single_measurement", { port });
}

export async function getConnectionState(port: string): Promise<ConnectionState> {
  return await invoke("get_connection_state", { port });
}

export async function listConnectedPorts(): Promise<string[]> {
  return await invoke("list_connected_ports");
}

export async function shutdownDevices(): Promise<void> {
  await invoke("shutdown_devices");
}

/* ==================== EVENTOS ==================== */

/**
 * Escucha el canal de eventos del backend.
 *
 * Devuelve una función para dejar de escuchar; el caller debe llamarla al
 * desmontar el componente.
 */
export async function listenMeasurementEvents(
  callback: (event: MeasurementEventType) => void
): Promise<() => void> {
  const unlisten = await listen<MeasurementEventType>("measurement-event", (event) => {
    callback(event.payload);
  });
  return unlisten;
}