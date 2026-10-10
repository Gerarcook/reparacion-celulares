// Comandos Tauri que exponen el `DeviceManager` al frontend.

use tauri::{AppHandle, Emitter, State};

use crate::usb::{
    ConnectionState, DeviceInfo, DeviceManagerState, DriverType, Measurement, MeasurementEvent,
    MeasurementMode,
};

// Comando: Escanear puertos disponibles
#[tauri::command]
pub async fn scan_devices(manager: State<'_, DeviceManagerState>) -> Result<Vec<DeviceInfo>, String> {
    let mgr = manager.lock().await;
    mgr.scan_ports().await
}

// Comando: Conectar a dispositivo
#[tauri::command]
pub async fn connect_device(
    manager: State<'_, DeviceManagerState>,
    port: String,
    driver_type: DriverType,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.connect(&port, driver_type).await
}

// Comando: Desconectar dispositivo
#[tauri::command]
pub async fn disconnect_device(
    manager: State<'_, DeviceManagerState>,
    port: String,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.disconnect(&port).await
}

// Comando: Iniciar medición continua
#[tauri::command]
pub async fn start_measurement(
    manager: State<'_, DeviceManagerState>,
    port: String,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.start_measurement(&port).await
}

// Comando: Detener medición continua
#[tauri::command]
pub async fn stop_measurement(
    manager: State<'_, DeviceManagerState>,
    port: String,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.stop_measurement(&port).await
}

// Comando: Cambiar modo de medición
#[tauri::command]
pub async fn set_measurement_mode(
    manager: State<'_, DeviceManagerState>,
    port: String,
    mode: MeasurementMode,
) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.set_mode(&port, mode).await
}

// Comando: Leer medición única
#[tauri::command]
pub async fn read_single_measurement(
    manager: State<'_, DeviceManagerState>,
    port: String,
) -> Result<Measurement, String> {
    let mut mgr = manager.lock().await;
    mgr.read_single(&port).await
}

// Comando: Obtener estado de conexión
#[tauri::command]
pub async fn get_connection_state(
    manager: State<'_, DeviceManagerState>,
    port: String,
) -> Result<ConnectionState, String> {
    let mgr = manager.lock().await;
    Ok(mgr.get_state(&port))
}

// Comando: Listar puertos conectados
#[tauri::command]
pub async fn list_connected_ports(
    manager: State<'_, DeviceManagerState>,
) -> Result<Vec<String>, String> {
    let mgr = manager.lock().await;
    Ok(mgr.connected_ports())
}

/// Pollea los puertos para detectar plugged/unplugged.
///
/// `serialport` no expone hotplug en Windows, así que el frontend invoca este
/// comando cada pocos segundos. El backend solo emite si la lista cambió.
#[tauri::command]
pub async fn poll_ports(manager: State<'_, DeviceManagerState>) -> Result<(), String> {
    let mut mgr = manager.lock().await;
    mgr.poll_ports().await;
    Ok(())
}

/// Sanea al salir: cierra los puertos para que el sistema los libere.
///
/// Sin esto, un cierre forzado deja los multílmetros en un estado raro y
/// Windows tarda en liberar el COM.
#[tauri::command]
pub async fn shutdown_devices(manager: State<'_, DeviceManagerState>) -> Result<(), String> {
    let ports = {
        let mgr = manager.lock().await;
        mgr.connected_ports()
    };

    for port in ports {
        let mut mgr = manager.lock().await;
        if let Err(e) = mgr.disconnect(&port).await {
            log::warn!("No se pudo cerrar {port} limpiamente: {e}");
        }
    }

    Ok(())
}

/// Inicia el puente de eventos del backend hacia el frontend.
///
/// Corre en una tarea propia: solo lee del canal y emite. Si el frontend se
/// cae, `emit` empieza a fallar y la tarea termina, evitando un leak.
pub fn start_event_loop(app: AppHandle, manager: DeviceManagerState) {
    tokio::spawn(async move {
        let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<MeasurementEvent>();

        {
            let mut mgr = manager.lock().await;
            mgr.set_event_sender(tx);
        }

        while let Some(event) = rx.recv().await {
            if app.emit("measurement-event", &event).is_err() {
                log::warn!("No se pudo emitir el evento: la ventana se cerró");
                break;
            }
        }
    });
}