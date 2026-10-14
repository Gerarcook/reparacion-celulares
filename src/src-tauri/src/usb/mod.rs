// Módulo de comunicación USB/Serial para multímetros
// Arquitectura modular: cada driver implementa el trait `MultimeterDriver`

pub mod drivers;
pub mod manager;
pub mod protocol;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio::sync::Mutex;

/// Resultado de una medición
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Measurement {
    pub timestamp: u64,           // Unix millis
    pub value: f64,
    pub unit: String,             // "V", "A", "Ω", "Hz", "°C", etc.
    pub mode: MeasurementMode,
    pub is_relative: bool,
    pub is_overflow: bool,
}

/// Modos de medición soportados.
///
/// Los nombres van explícitos porque `rename_all = "snake_case"` parte los
/// acrónimos: `VoltageDC` se volvería `voltage_d_c`, y el frontend espera
/// `voltage_dc`. Ver `src/types/index.ts`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MeasurementMode {
    #[serde(rename = "voltage_dc")]
    VoltageDC,
    #[serde(rename = "voltage_ac")]
    VoltageAC,
    #[serde(rename = "current_dc")]
    CurrentDC,
    #[serde(rename = "current_ac")]
    CurrentAC,
    #[serde(rename = "resistance")]
    Resistance,
    #[serde(rename = "continuity")]
    Continuity,
    #[serde(rename = "diode")]
    Diode,
    #[serde(rename = "capacitance")]
    Capacitance,
    #[serde(rename = "frequency")]
    Frequency,
    #[serde(rename = "temperature")]
    Temperature,
    #[serde(rename = "duty_cycle")]
    DutyCycle,
    #[serde(rename = "unknown")]
    Unknown,
}

impl MeasurementMode {
    pub fn unit(&self) -> &'static str {
        match self {
            MeasurementMode::VoltageDC | MeasurementMode::VoltageAC => "V",
            MeasurementMode::CurrentDC | MeasurementMode::CurrentAC => "A",
            MeasurementMode::Resistance => "Ω",
            MeasurementMode::Continuity => "Ω",
            MeasurementMode::Diode => "V",
            MeasurementMode::Capacitance => "F",
            MeasurementMode::Frequency => "Hz",
            MeasurementMode::Temperature => "°C",
            MeasurementMode::DutyCycle => "%",
            MeasurementMode::Unknown => "",
        }
    }
}

/// Información del dispositivo detectado
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub port: String,              // "COM3", "/dev/ttyUSB0"
    pub vendor_id: Option<u16>,
    pub product_id: Option<u16>,
    pub manufacturer: Option<String>,
    pub product: Option<String>,
    pub serial_number: Option<String>,
    pub driver_type: DriverType,
}

/// Tipo de driver detectado.
///
/// Renames explícitos por el mismo motivo que en `MeasurementMode`:
/// `rename_all = "snake_case"` produciría `unit_u_t`.
///
/// `SCPI` es un acrónimo y se escribe en mayúsculas por convención del
/// estándar IEEE 488.2.
#[allow(clippy::upper_case_acronyms)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DriverType {
    #[serde(rename = "unit_ut")]
    UnitUT,
    #[serde(rename = "aneng")]
    Aneng,
    #[serde(rename = "scpi")]
    SCPI,
    #[serde(rename = "unknown")]
    Unknown,
}

impl DriverType {
    /// Nombre corto para mostrar en la UI.
    pub fn label(&self) -> &'static str {
        match self {
            DriverType::UnitUT => "Uni-T",
            DriverType::Aneng => "ANENG",
            DriverType::SCPI => "SCPI",
            DriverType::Unknown => "Desconocido",
        }
    }
}

/// Estado de la conexión
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Disconnected,
    Connecting,
    Connected,
    Error,
}

impl std::fmt::Display for ConnectionState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let s = match self {
            ConnectionState::Disconnected => "desconectado",
            ConnectionState::Connecting => "conectando",
            ConnectionState::Connected => "conectado",
            ConnectionState::Error => "error",
        };
        f.write_str(s)
    }
}

/// Eventos que el backend emite al frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event", content = "data")]
pub enum MeasurementEvent {
    DeviceListChanged(Vec<DeviceInfo>),
    ConnectionStateChanged { port: String, state: ConnectionState },
    MeasurementReceived(Measurement),
    Error(String),
}

/// Trait que deben implementar todos los drivers
#[async_trait::async_trait]
pub trait MultimeterDriver: Send + Sync {
    /// Nombre del driver, para mostrarlo en la UI.
    ///
    /// Se consulta al registrar las fábricas, así no cuenta como código muerto
    /// aunque la UI todavía no lo muestre.
    fn name(&self) -> &'static str;
    
    /// Tipo de driver
    fn driver_type(&self) -> DriverType;
    
    /// Abre conexión y configura el dispositivo
    async fn connect(&mut self, port: &str) -> Result<(), String>;
    
    /// Cierra conexión
    async fn disconnect(&mut self) -> Result<(), String>;
    
    /// Inicia medición continua, publicando en el canal dado.
    ///
    /// El driver recibe el canal en lugar de emitir por su cuenta: así el
    /// manager es el único que conoce el destino de las mediciones.
    async fn start_measurement(
        &mut self,
        sink: mpsc::UnboundedSender<MeasurementEvent>,
    ) -> Result<(), String>;
    
    /// Detiene medición continua
    async fn stop_measurement(&mut self) -> Result<(), String>;
    
    /// Lee una medición única (para modo single-shot)
    async fn read_single(&mut self) -> Result<Measurement, String>;
    
    /// Configura modo de medición
    async fn set_mode(&mut self, mode: MeasurementMode) -> Result<(), String>;
    
    /// Estado actual de conexión
    fn state(&self) -> ConnectionState;
}

/// Fábrica de drivers: permite crear una instancia por conexión.
pub type DriverFactory = Arc<dyn Fn() -> Box<dyn MultimeterDriver> + Send + Sync>;

/// Manager global de dispositivos
#[derive(Default)]
pub struct DeviceManager {
    factories: Vec<(DriverType, DriverFactory)>,
    connections: HashMap<String, Box<dyn MultimeterDriver>>,
    event_sender: Option<mpsc::UnboundedSender<MeasurementEvent>>,
    /// Último conjunto de puertos visto, para detectar cambios en el escaneo.
    known_ports: Vec<String>,
}

impl DeviceManager {
    pub fn new() -> Self {
        Self::default()
    }
    
    /// Registra una fábrica de driver.
    ///
    /// Se registran fábricas y no instancias porque `connect` mueve el driver
    /// fuera del pool. Con instancias, un segundo puerto del mismo modelo
    /// fallaría: el driver ya no estaría disponible.
    ///
    /// El `DriverType` se toma de una instancia de prueba, así no hay que
    /// repetirlo en el registro: si el driver dice un tipo distinto del
    /// esperado, el error aparece al conectar y no en dos lugares distintos.
    pub fn register_driver(&mut self, factory: DriverFactory) {
        let probe = factory();
        let driver_type = probe.driver_type();
        log::info!("Driver registrado: {} ({})", probe.name(), driver_type.label());

        self.factories.retain(|(t, _)| *t != driver_type);
        self.factories.push((driver_type, factory));
    }
    
    /// Configura el canal de eventos hacia el frontend
    pub fn set_event_sender(&mut self, sender: mpsc::UnboundedSender<MeasurementEvent>) {
        self.event_sender = Some(sender);
    }
    
    /// Emite evento al frontend
    fn emit(&self, event: MeasurementEvent) {
        if let Some(sender) = &self.event_sender {
            let _ = sender.send(event);
        }
    }
    
    /// Escanea puertos seriales disponibles
    pub async fn scan_ports(&self) -> Result<Vec<DeviceInfo>, String> {
        let ports = serialport::available_ports().map_err(|e| e.to_string())?;
        let mut devices = Vec::new();
        
        for port in ports {
            // Los descriptores USB se copian una sola vez: `port_type` no se
            // puede volver a prestar después de moverlo en un primer `match`.
            let (vendor_id, product_id, manufacturer, product, serial_number) =
                match &port.port_type {
                    serialport::SerialPortType::UsbPort(info) => (
                        Some(info.vid),
                        Some(info.pid),
                        info.manufacturer.clone(),
                        info.product.clone(),
                        info.serial_number.clone(),
                    ),
                    _ => (None, None, None, None, None),
                };
            
            let driver_type = detect_driver_type(&port.port_name, vendor_id, product_id, &manufacturer, &product);
            
            devices.push(DeviceInfo {
                port: port.port_name,
                vendor_id,
                product_id,
                manufacturer,
                product,
                serial_number,
                driver_type,
            });
        }
        
        Ok(devices)
    }
    
    /// Conecta a un dispositivo
    pub async fn connect(&mut self, port: &str, driver_type: DriverType) -> Result<(), String> {
        if self.connections.contains_key(port) {
            return Err(format!("El puerto {port} ya está conectado"));
        }
        
        let factory = self
            .factories
            .iter()
            .find(|(t, _)| *t == driver_type)
            .map(|(_, f)| f.clone())
            .ok_or_else(|| format!("No hay driver registrado para {}", driver_type.label()))?;
        
        let mut driver = factory();
        driver.connect(port).await?;
        
        self.emit(MeasurementEvent::ConnectionStateChanged {
            port: port.to_string(),
            state: ConnectionState::Connected,
        });
        
        self.connections.insert(port.to_string(), driver);
        Ok(())
    }
    
    /// Desconecta un dispositivo
    pub async fn disconnect(&mut self, port: &str) -> Result<(), String> {
        if let Some(mut driver) = self.connections.remove(port) {
            driver.disconnect().await?;
            self.emit(MeasurementEvent::ConnectionStateChanged {
                port: port.to_string(),
                state: ConnectionState::Disconnected,
            });
        }
        Ok(())
    }
    
    /// Inicia medición continua en un puerto
    pub async fn start_measurement(&mut self, port: &str) -> Result<(), String> {
        // El canal se clona para que el driver pueda publicar sin volver a
        // tomar el lock del manager.
        let sink = self
            .event_sender
            .clone()
            .ok_or("El canal de eventos no está inicializado")?;
        
        if let Some(driver) = self.connections.get_mut(port) {
            driver.start_measurement(sink).await
        } else {
            Err("Dispositivo no conectado".to_string())
        }
    }
    
    /// Detiene medición continua
    pub async fn stop_measurement(&mut self, port: &str) -> Result<(), String> {
        if let Some(driver) = self.connections.get_mut(port) {
            driver.stop_measurement().await
        } else {
            Err("Dispositivo no conectado".to_string())
        }
    }
    
    /// Cambia modo de medición
    pub async fn set_mode(&mut self, port: &str, mode: MeasurementMode) -> Result<(), String> {
        if let Some(driver) = self.connections.get_mut(port) {
            driver.set_mode(mode).await
        } else {
            Err("Dispositivo no conectado".to_string())
        }
    }
    
    /// Lee una medición única
    pub async fn read_single(&mut self, port: &str) -> Result<Measurement, String> {
        if let Some(driver) = self.connections.get_mut(port) {
            driver.read_single().await
        } else {
            Err("Dispositivo no conectado".to_string())
        }
    }
    
    /// Obtiene estado de conexión
    pub fn get_state(&self, port: &str) -> ConnectionState {
        self.connections.get(port).map(|d| d.state()).unwrap_or(ConnectionState::Disconnected)
    }
    
    /// Lista puertos conectados
    pub fn connected_ports(&self) -> Vec<String> {
        self.connections.keys().cloned().collect()
    }
    
    /// Re-escanea y avisa al frontend si la lista de puertos cambió.
    ///
    /// `serialport` no expone un evento de hotplug en Windows, así que el
    /// frontend lo invoca periódicamente.
    pub async fn poll_ports(&mut self) {
        let devices = match self.scan_ports().await {
            Ok(d) => d,
            Err(e) => {
                log::warn!("Error escaneando puertos: {e}");
                return;
            }
        };
        
        let present: Vec<String> = devices.iter().map(|d| d.port.clone()).collect();
        if present == self.known_ports {
            return;
        }
        
        self.known_ports = present;
        
        // Un puerto conectado que ya no aparece fue desconectado de golpe:
        // hay que limpiarlo o el frontend queda mostrando un dispositivo muerto.
        let gone: Vec<String> = self
            .connections
            .keys()
            .filter(|p| !devices.iter().any(|d| &&d.port == p))
            .cloned()
            .collect();
        
        for port in gone {
            log::warn!("Puerto {port} desconectado físicamente");
            if let Some(mut driver) = self.connections.remove(&port) {
                let _ = driver.disconnect().await;
                self.emit(MeasurementEvent::ConnectionStateChanged {
                    port,
                    state: ConnectionState::Disconnected,
                });
            }
        }
        
        self.emit(MeasurementEvent::DeviceListChanged(devices));
    }
}

/// Detecta el tipo de driver a partir de los descriptores USB.
fn detect_driver_type(
    port_name: &str,
    vid: Option<u16>,
    pid: Option<u16>,
    manufacturer: &Option<String>,
    product: &Option<String>,
) -> DriverType {
    let haystack = format!(
        "{} {} {}",
        manufacturer.as_deref().unwrap_or_default(),
        product.as_deref().unwrap_or_default(),
        port_name
    )
    .to_lowercase();
    
    // SCPI primero: un Fluke también puede llevar un CP210x, así que buscar
    // por marca de laboratorio tiene prioridad sobre el chip USB.
    const SCPI_VENDORS: [&str; 6] = ["fluke", "keysight", "rigol", "siglent", "tektronix", "rohde"];
    if SCPI_VENDORS.iter().any(|v| haystack.contains(v)) {
        return DriverType::SCPI;
    }
    
    if haystack.contains("aneng") {
        return DriverType::Aneng;
    }
    
    if haystack.contains("uni-t") || haystack.contains("uni_t") {
        return DriverType::UnitUT;
    }
    
    // Último recurso: el chip USB. Muchos clonados chinos no publican marca,
    // así que el VID/PID es la única señal disponible.
    match vid {
        Some(0x1A86) | Some(0x7523) => DriverType::Aneng,   // WCH CH340 / CH341
        Some(0x10C4) => match pid {
            Some(0xEA60) => DriverType::UnitUT,               // CP2102 en Uni-T
            _ => DriverType::Unknown,
        },
        _ => DriverType::Unknown,
    }
}

/// Estado global para Tauri
pub type DeviceManagerState = Arc<Mutex<DeviceManager>>;

/// Crea el manager con los drivers registrados.
pub fn create_manager() -> DeviceManager {
    let mut manager = DeviceManager::new();
    
    manager.register_driver(Arc::new(|| Box::new(drivers::UnitUTDriver::new())));
    manager.register_driver(Arc::new(|| Box::new(drivers::AnengDriver::new())));
    manager.register_driver(Arc::new(|| Box::new(drivers::SCPIDriver::new())));
    
    manager
}

#[cfg(test)]
mod tests {
    use super::*;

    

    #[test]
    fn detecta_uni_t_por_marca() {
        assert_eq!(detect_driver_type("COM3", None, None, &Some("UNI-T".into()), &None), DriverType::UnitUT);
    }

    #[test]
    fn detecta_aneng_por_marca() {
        assert_eq!(detect_driver_type("COM3", None, None, &Some("ANENG".into()), &None), DriverType::Aneng);
    }

    #[test]
    fn scpi_tiene_prioridad_sobre_el_chip_usb() {
        // Un Fluke con CP210x debe detectarse como SCPI, no como genérico.
        assert_eq!(
            detect_driver_type("COM5", Some(0x10C4), Some(0xEA60), &Some("Fluke".into()), &None),
            DriverType::SCPI
        );
    }

    #[test]
    fn detecta_aneng_por_chip_ch340() {
        assert_eq!(detect_driver_type("COM7", Some(0x1A86), Some(0x7523), &None, &None), DriverType::Aneng);
    }

    #[test]
    fn puerto_desconocido_no_inventa_driver() {
        assert_eq!(detect_driver_type("COM9", Some(0x1234), None, &None, &None), DriverType::Unknown);
    }

    #[test]
    fn los_modos_serializan_como_snake_case() {
        // El frontend envía "voltage_dc"; si esto cambia, la UI rompe en silencio.
        let json = serde_json::to_string(&MeasurementMode::VoltageDC).unwrap();
        assert_eq!(json, "\"voltage_dc\"");
    }

    #[test]
    fn los_tipos_de_driver_serializan_como_snake_case() {
        assert_eq!(serde_json::to_string(&DriverType::UnitUT).unwrap(), "\"unit_ut\"");
    }

    #[test]
    fn el_frontend_puede_parsear_un_modo_enviado() {
        let mode: MeasurementMode = serde_json::from_str("\"current_ac\"").unwrap();
        assert_eq!(mode, MeasurementMode::CurrentAC);
    }

    #[test]
    fn un_tipo_de_driver_desconocido_igual_deserializa() {
        // El frontend manda "unknown" cuando la autodetección no acierta.
        let driver: DriverType = serde_json::from_str("\"unknown\"").unwrap();
        assert_eq!(driver, DriverType::Unknown);
    }

    #[test]
    fn un_modo_invalido_se_rechaza_en_vez_de_silenciarse() {
        // Si el frontend mandara "voltagedc", tiene que fallar ruidosamente:
        // un default silencioso mostraría lecturas con la unidad equivocada.
        assert!(serde_json::from_str::<MeasurementMode>("\"voltagedc\"").is_err());
    }

    #[test]
    fn todas_las_unidades_de_modo_estan_definidas() {
        let modes = [
            MeasurementMode::VoltageDC,
            MeasurementMode::VoltageAC,
            MeasurementMode::CurrentDC,
            MeasurementMode::CurrentAC,
            MeasurementMode::Resistance,
            MeasurementMode::Continuity,
            MeasurementMode::Diode,
            MeasurementMode::Capacitance,
            MeasurementMode::Frequency,
            MeasurementMode::Temperature,
            MeasurementMode::DutyCycle,
        ];

        for mode in modes {
            assert!(!mode.unit().is_empty(), "{mode:?} quedó sin unidad");
        }
    }

    #[test]
    fn el_modo_desconocido_no_inventa_una_unidad() {
        // Sin unidad es correcto para `Unknown`: inventar "V" haría que la UI
        // mostrara una lectura sin contexto como si fuera una tensión.
        assert_eq!(MeasurementMode::Unknown.unit(), "");
    }

    #[test]
    fn la_unidad_de_tension_es_voltios() {
        assert_eq!(MeasurementMode::VoltageDC.unit(), "V");
        assert_eq!(MeasurementMode::VoltageAC.unit(), "V");
    }
}