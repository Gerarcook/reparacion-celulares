// Driver para multímetros Uni-T (UT61E, UT171B, UT181A, UT33C, etc.)
//
// Protocolo de 14 bytes fijo a 2400 baud, 8N1.

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::usb::protocol::{boxed_parser, SerialLink, FRAME_LEN_14};
use crate::usb::{ConnectionState, DriverType, Measurement, MeasurementEvent, MeasurementMode, MultimeterDriver};

/// Baud rate del protocolo Uni-T.
const BAUD_RATE: u32 = 2400;

/// Driver para multímetros Uni-T.
pub struct UnitUTDriver {
    link: Option<SerialLink>,
    state: ConnectionState,
    current_mode: MeasurementMode,
    measure_sink: Option<mpsc::UnboundedSender<Measurement>>,
}

impl UnitUTDriver {
    pub fn new() -> Self {
        Self {
            link: None,
            state: ConnectionState::Disconnected,
            current_mode: MeasurementMode::VoltageDC,
            measure_sink: None,
        }
    }

    /// Parsea un frame Uni-T de 14 bytes.
    ///
    /// Formato: byte 0 de inicio (0xAA o 0x55), byte 1 con modo en los bits
    /// bajos y rango en los altos, bytes 2-5 con el valor BCD, byte 6 con la
    /// unidad y el flag de overflow, byte 7 con flags.
    fn parse_unidata(data: &[u8]) -> Option<Measurement> {
        if data.len() < FRAME_LEN_14 {
            return None;
        }
        
        let start = data[0];
        if start != 0xAA && start != 0x55 {
            return None;
        }
        
        let mode = decode_mode(data[1]);
        let value = decode_value(&data[2..6], data[1]);
        let (unit, is_overflow) = decode_unit(data[6], mode);
        
        Some(Measurement {
            timestamp: now_millis(),
            value,
            unit,
            mode,
            is_relative: (data[7] & 0x01) != 0,
            is_overflow,
        })
    }
}

impl Default for UnitUTDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl MultimeterDriver for UnitUTDriver {
    fn name(&self) -> &'static str {
        "Uni-T (UT61E, UT171B, UT181A, UT33C, etc.)"
    }
    
    fn driver_type(&self) -> DriverType {
        DriverType::UnitUT
    }
    
    async fn connect(&mut self, port: &str) -> Result<(), String> {
        self.state = ConnectionState::Connecting;
        
        match SerialLink::open(port, BAUD_RATE) {
            Ok(link) => {
                log::info!("Uni-T conectado en {port} a {BAUD_RATE} baud");
                self.link = Some(link);
                self.state = ConnectionState::Connected;
                Ok(())
            }
            Err(e) => {
                self.state = ConnectionState::Error;
                Err(e)
            }
        }
    }
    
    async fn disconnect(&mut self) -> Result<(), String> {
        if let Some(mut link) = self.link.take() {
            link.close().await;
        }
        self.measure_sink = None;
        self.state = ConnectionState::Disconnected;
        Ok(())
    }
    
    async fn start_measurement(
        &mut self,
        sink: mpsc::UnboundedSender<MeasurementEvent>,
    ) -> Result<(), String> {
        let link = self.link.as_mut().ok_or("No conectado")?;
        
        // El canal de eventos se reenvuelve: el link publica mediciones y este
        // puente las convierte en eventos para el frontend.
        let (measure_tx, mut measure_rx) = mpsc::unbounded_channel::<Measurement>();
        let port = link.port_name().to_string();
        
        // `measure_tx` se clona: una copia viaja a la tarea de lectura y la otra
        // queda guardada para poder cerrar el canal en `stop_measurement`.
        let task_tx = measure_tx.clone();
        
        link.start_continuous(
            FRAME_LEN_14,
            boxed_parser(|frame| Self::parse_unidata(frame)),
            task_tx,
        );
        
        self.measure_sink = Some(measure_tx);
        
        tokio::spawn(async move {
            while let Some(measurement) = measure_rx.recv().await {
                let _ = sink.send(MeasurementEvent::MeasurementReceived(measurement));
            }
            log::debug!("Puente de mediciones cerrado para {port}");
        });
        
        Ok(())
    }
    
    async fn stop_measurement(&mut self) -> Result<(), String> {
        self.measure_sink = None;
        if let Some(link) = self.link.as_mut() {
            link.stop().await;
        }
        Ok(())
    }
    
    async fn read_single(&mut self) -> Result<Measurement, String> {
        let link = self.link.as_mut().ok_or("No conectado")?;
        let parser = boxed_parser(|frame| Self::parse_unidata(frame));
        link.read_frame(FRAME_LEN_14, &parser).await
    }
    
    async fn set_mode(&mut self, mode: MeasurementMode) -> Result<(), String> {
        // Uni-T no permite cambiar el modo por software: es un selector físico
        // en el instrumento. Se registra igual para mostrar el modo en la UI.
        self.current_mode = mode;
        Ok(())
    }
    
    fn state(&self) -> ConnectionState {
        self.state
    }
}

/// Unix millis, tolerante a relojes con fecha anterior a 1970.
pub(crate) fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn decode_mode(mode_byte: u8) -> MeasurementMode {
    match mode_byte & 0x0F {
        0x00 => MeasurementMode::VoltageDC,
        0x01 => MeasurementMode::VoltageAC,
        0x02 => MeasurementMode::CurrentDC,
        0x03 => MeasurementMode::CurrentAC,
        0x04 => MeasurementMode::Resistance,
        0x05 => MeasurementMode::Capacitance,
        0x06 => MeasurementMode::Frequency,
        0x07 => MeasurementMode::Temperature,
        0x08 => MeasurementMode::Diode,
        0x09 => MeasurementMode::Continuity,
        _ => MeasurementMode::Unknown,
    }
}

/// Decodifica el valor BCD de 4 bytes aplicando el punto decimal del rango.
fn decode_value(bytes: &[u8], mode_byte: u8) -> f64 {
    let range = (mode_byte >> 4) & 0x07;
    
    let raw = ((bytes[0] as u32) << 24)
        | ((bytes[1] as u32) << 16)
        | ((bytes[2] as u32) << 8)
        | (bytes[3] as u32);
    
    let mut value = 0.0;
    let mut multiplier = 1.0;
    let mut temp = raw;
    
    for _ in 0..8 {
        let digit = (temp & 0xF) as f64;
        // Un dígito BCD mayor que 9 significa frame corrupto.
        if digit > 9.0 {
            return f64::NAN;
        }
        value += digit * multiplier;
        multiplier *= 10.0;
        temp >>= 4;
    }
    
    let decimal_pos = match range {
        0 => 3, // 0.000
        1 => 2, // 00.00
        2 => 1, // 000.0
        3 => 0, // 0000
        4 => 4, // 0.0000
        5 => 5, // 0.00000
        _ => 3,
    };
    
    value / 10_f64.powi(decimal_pos)
}

fn decode_unit(unit_byte: u8, mode: MeasurementMode) -> (String, bool) {
    let is_overflow = (unit_byte & 0x80) != 0;
    
    let unit = match mode {
        MeasurementMode::VoltageDC | MeasurementMode::VoltageAC => match unit_byte & 0x0F {
            0 => "mV",
            1 => "V",
            2 => "kV",
            _ => "V",
        },
        MeasurementMode::CurrentDC | MeasurementMode::CurrentAC => match unit_byte & 0x0F {
            0 => "µA",
            1 => "mA",
            2 => "A",
            _ => "A",
        },
        MeasurementMode::Resistance | MeasurementMode::Continuity | MeasurementMode::Diode => match unit_byte & 0x0F {
            0 => "Ω",
            1 => "kΩ",
            2 => "MΩ",
            _ => "Ω",
        },
        MeasurementMode::Capacitance => match unit_byte & 0x0F {
            0 => "nF",
            1 => "µF",
            2 => "mF",
            _ => "F",
        },
        MeasurementMode::Frequency => match unit_byte & 0x0F {
            0 => "Hz",
            1 => "kHz",
            2 => "MHz",
            _ => "Hz",
        },
        MeasurementMode::Temperature => "°C",
        _ => "",
    };
    
    (unit.to_string(), is_overflow)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construye un frame Uni-T con header, modo, valor BCD y unidad.
    fn frame(mode_byte: u8, bcd: [u8; 4], unit_byte: u8, flags: u8) -> [u8; FRAME_LEN_14] {
        let mut f = [0u8; FRAME_LEN_14];
        f[0] = 0xAA;
        f[1] = mode_byte;
        f[2..6].copy_from_slice(&bcd);
        f[6] = unit_byte;
        f[7] = flags;
        f
    }

    #[test]
    fn decodifica_tension_en_voltios() {
        // Byte de modo 0x10 = nibble bajo 0x00 (VoltageDC), nibble alto 0x1
        // (rango 1, dos decimales). BCD 0x12345678 = 12345678.
        let f = frame(0x10, [0x12, 0x34, 0x56, 0x78], 0x01, 0x00);
        let m = UnitUTDriver::parse_unidata(&f).expect("debería parsear");
        
        assert_eq!(m.mode, MeasurementMode::VoltageDC);
        assert_eq!(m.value, 123456.78);
        assert_eq!(m.unit, "V");
        assert!(!m.is_overflow);
    }

    #[test]
    fn decodifica_resistencia_en_kilo_ohm() {
        let f = frame(0x14, [0x00, 0x00, 0x10, 0x00], 0x01, 0x00);
        let m = UnitUTDriver::parse_unidata(&f).expect("debería parsear");
        
        assert_eq!(m.mode, MeasurementMode::Resistance);
        assert_eq!(m.unit, "kΩ");
    }

    #[test]
    fn detecta_overflow() {
        let f = frame(0x10, [0x00, 0x00, 0x00, 0x00], 0x81, 0x00);
        let m = UnitUTDriver::parse_unidata(&f).expect("debería parsear");
        assert!(m.is_overflow);
    }

    #[test]
    fn detecta_modo_relativo() {
        let f = frame(0x10, [0x00, 0x00, 0x01, 0x00], 0x01, 0x01);
        let m = UnitUTDriver::parse_unidata(&f).expect("debería parsear");
        assert!(m.is_relative);
    }

    #[test]
    fn rechaza_header_invalido() {
        let mut f = frame(0x11, [0x00, 0x00, 0x00, 0x00], 0x01, 0x00);
        f[0] = 0x42;
        assert!(UnitUTDriver::parse_unidata(&f).is_none());
    }

    #[test]
    fn rechaza_frame_corto() {
        assert!(UnitUTDriver::parse_unidata(&[0xAA, 0x11]).is_none());
    }

    #[test]
    fn rechaza_bcd_corrupto() {
        // 0xAB no es un dígito BCD válido.
        let f = frame(0x10, [0xAB, 0x00, 0x00, 0x00], 0x01, 0x00);
        let m = UnitUTDriver::parse_unidata(&f).expect("parsea el frame");
        assert!(m.value.is_nan(), "un dígito BCD inválido debe dar NaN");
    }

    #[test]
    fn modo_desconocido_cae_en_unknown() {
        assert_eq!(decode_mode(0x0F), MeasurementMode::Unknown);
    }

    #[test]
    fn la_escala_sigue_al_rango_del_byte_de_modo() {
        // Mismo BCD con rango 3 (sin decimales) da un valor 100x mayor.
        let sin_decimales = frame(0x30, [0x12, 0x34, 0x56, 0x78], 0x01, 0x00);
        let m = UnitUTDriver::parse_unidata(&sin_decimales).expect("debería parsear");
        assert_eq!(m.value, 12345678.0);
    }
}