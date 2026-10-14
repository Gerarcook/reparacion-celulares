mod usb;

use std::sync::Arc;

use tauri::{Listener, Manager};

/// Comando de prueba, útil para verificar que el puente JS-Rust funciona.
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hola, {}! Bienvenido a VolFix", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // El manager va envuelto en `Arc` porque el bucle de eventos, el listener de
    // cierre y los comandos comparten el mismo estado. Registrarlo como
    // `Arc<Mutex<DeviceManager>>` es lo que permite que
    // `State<'_, DeviceManagerState>` funcione en todos los comandos.
    let manager_state: usb::DeviceManagerState = Arc::new(tokio::sync::Mutex::new(usb::create_manager()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(manager_state.clone())
        .invoke_handler(tauri::generate_handler![
            greet,
            usb::manager::scan_devices,
            usb::manager::poll_ports,
            usb::manager::connect_device,
            usb::manager::disconnect_device,
            usb::manager::start_measurement,
            usb::manager::stop_measurement,
            usb::manager::set_measurement_mode,
            usb::manager::read_single_measurement,
            usb::manager::get_connection_state,
            usb::manager::list_connected_ports,
            usb::manager::shutdown_devices,
        ])
        .setup(move |app| {
            #[cfg(debug_assertions)]
            if let Some(window) = app.get_webview_window("main") {
                window.open_devtools();
            }

            // El puente de eventos debe arrancar antes que cualquier comando:
            // si un dispositivo ya está midiendo, las mediciones se descartan
            // mientras no haya alguien escuchando.
            usb::manager::start_event_loop(app.handle().clone(), manager_state.clone());

            // Limpieza al cerrar: los puertos COM no se liberan solos.
            // El estado se clona para no mover `handle` dentro del listener,
            // que lo tiene prestado mientras dura el callback.
            let state = manager_state.clone();
            app.handle().listen("tauri://close-requested", move |_event| {
                let state = state.clone();
                tauri::async_runtime::spawn(async move {
                    let ports = {
                        let mgr = state.lock().await;
                        mgr.connected_ports()
                    };
                    for port in ports {
                        let mut mgr = state.lock().await;
                        if let Err(e) = mgr.disconnect(&port).await {
                            log::warn!("No se pudo cerrar {port} limpiamente: {e}");
                        }
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error al ejecutar la aplicación Tauri");
}