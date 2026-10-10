// Tipos compartidos con el backend Rust.
//
// Los nombres de `MeasurementMode` y `DriverType` tienen que coincidir con el
// `#[serde(rename_all = "snake_case")]` de `src-tauri/src/usb/mod.rs`. Si se
// cambia de un lado, hay que cambiarlo del otro.

export type FileType = "pdf" | "image";

/* ==================== ESQUEMÁTICOS ==================== */

export interface Schematic {
  id: string;
  name: string;
  filePath: string;
  fileType: FileType;
  /** ISO string, no `Date`: localStorage solo serializa strings. */
  uploadedAt: string;
  deviceModel?: string;
  notes?: string;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * Punto de prueba marcado sobre el esquemático.
 *
 * `expected` es lo que hace útil la herramienta: el técnico declara el valor
 * esperado en cada punto y la UI puede alertar cuando la medición real se
 * aparta de él.
 */
export interface Annotation {
  id: string;
  point: Point;
  label: string;
  color: string;
  timestamp: string;
  /**
   * Página del PDF donde está el punto, 1-indexada.
   *
   * Solo tiene sentido en el visor de PDF; en el visor de imagen no se usa.
   */
  page?: number;
  /** Rango esperado para este punto, en la unidad de la medición. */
  expected?: {
    min?: number;
    max?: number;
    unit?: string;
  };
  /** Último valor medido en este punto. */
  lastReading?: Measurement;
}

/** Una sesión de diagnóstico sobre un esquemático. */
export interface Case {
  id: string;
  schematicId: string;
  deviceModel: string;
  issue: string;
  createdAt: string;
  updatedAt: string;
  status: "open" | "in-progress" | "resolved";
  measurements?: Measurement[];
  notes?: string;
}

/* ==================== USB / MEDICIONES ==================== */

export type MeasurementMode =
  | "voltage_dc"
  | "voltage_ac"
  | "current_dc"
  | "current_ac"
  | "resistance"
  | "continuity"
  | "diode"
  | "capacitance"
  | "frequency"
  | "temperature"
  | "duty_cycle"
  | "unknown";

export type DriverType = "unit_ut" | "aneng" | "scpi" | "unknown";

export interface Measurement {
  /** Unix millis. */
  timestamp: number;
  value: number;
  unit: string;
  mode: MeasurementMode;
  is_relative: boolean;
  is_overflow: boolean;
}

export interface DeviceInfo {
  port: string;
  vendor_id: number | null;
  product_id: number | null;
  manufacturer: string | null;
  product: string | null;
  serial_number: string | null;
  driver_type: DriverType;
}

export type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

export interface DriverInfo {
  name: string;
  driver_type: DriverType;
  supported_models: string[];
}

export type MeasurementEventType =
  | { event: "DeviceListChanged"; data: DeviceInfo[] }
  | { event: "ConnectionStateChanged"; data: { port: string; state: ConnectionState } }
  | { event: "MeasurementReceived"; data: Measurement }
  | { event: "Error"; data: string };