// Driver para multímetros ANENG (AN8008, AN8009, AN870, AN7028, etc.)
//
// Protocolo de 14 bytes similar a Uni-T, con mapeos de modo y rango propios.

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::usb::drivers::unit_ut::now_millis;
use crate::usb::protocol::{boxed_parser, SerialLink, FRAME_LEN_14};
use crate::usb::{ConnectionState, DriverType, Measurement, MeasurementEvent, MeasurementMode, MultimeterDriver};

/// Baud rate del protocolo ANENG.
const BAUD_RATE: u32 = 2400;

/// Driver para multímetros ANENG.
pub struct AnengDriver {
    link: Option<SerialLink>,
    state: ConnectionState,
    current_mode: MeasurementMode,
    measure_sink: Option<mpsc::UnboundedSender<Measurement>>,
}

impl AnengDriver {
    pub fn new() -> Self {
        Self {
            link: None,
            state: ConnectionState::Disconnected,
            current_mode: MeasurementMode::VoltageDC,
            measure_sink: None,
        }
    }

    /// Parsea un frame ANENG de 14 bytes.
    fn parse_aneng(data: &[u8]) -> Option<Measurement> {
        if data.len() < FRAME_LEN_14 || data[0] != 0xAA {
            return None;
        }
        
        let mode = Self::decode_mode(data[1]);
        let value = Self::decode_value(&data[2..6], data[1]);
        let (unit, is_overflow) = Self::decode_unit(data[6], mode);
        
        Some(Measurement {
            timestamp: now_millis(),
            value,
            unit,
            mode,
            is_relative: (data[7] & 0x01) != 0,
            is_overflow,
        })
    }

    /// Mapeo de modo de los AN8008/AN8009: 5 bits, incluye duty cycle.
    fn decode_mode(mode_byte: u8) -> MeasurementMode {
        match mode_byte & 0x1F {
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
            0x0A => MeasurementMode::DutyCycle,
            _ => MeasurementMode::Unknown,
        }
    }

    /// ANENG usa 3 bits de rango, en los bits altos del byte de modo.
    fn decode_value(bytes: &[u8], mode_byte: u8) -> f64 {
        let range = (mode_byte >> 5) & 0x07;
        
        let raw = ((bytes[0] as u32) << 24)
            | ((bytes[1] as u32) << 16)
            | ((bytes[2] as u32) << 8)
            | (bytes[3] as u32);
        
        let mut value = 0.0;
        let mut multiplier = 1.0;
        let mut temp = raw;
        
        for _ in 0..8 {
            let digit = (temp & 0xF) as f64;
            if digit > 9.0 {
                return f64::NAN;
            }
            value += digit * multiplier;
            multiplier *= 10.0;
            temp >>= 4;
        }
        
        let decimal_pos = match range {
            0 => 3, 1 => 2, 2 => 1, 3 => 0,
            4 => 4, 5 => 5, _ => 3,
        };
        
        value / 10_f64.powi(decimal_pos)
    }

    fn decode_unit(unit_byte: u8, mode: MeasurementMode) -> (String, bool) {
        let is_overflow = (unit_byte & 0x80) != 0;
        
        let unit = match mode {
            MeasurementMode::VoltageDC | MeasurementMode::VoltageAC => match unit_byte & 0x07 {
                0 => "mV", 1 => "V", _ => "V",
            },
            MeasurementMode::CurrentDC | MeasurementMode::CurrentAC => match unit_byte & 0x07 {
                0 => "µA", 1 => "mA", 2 => "A", _ => "A",
            },
            MeasurementMode::Resistance | MeasurementMode::Continuity | MeasurementMode::Diode => match unit_byte & 0x07 {
                0 => "Ω", 1 => "kΩ", 2 => "MΩ", _ => "Ω",
            },
            MeasurementMode::Capacitance => match unit_byte & 0x07 {
                0 => "nF", 1 => "µF", 2 => "mF", _ => "F",
            },
            MeasurementMode::Frequency => match unit_byte & 0x07 {
                0 => "Hz", 1 => "kHz", 2 => "MHz", _ => "Hz",
            },
            MeasurementMode::Temperature => "°C",
            MeasurementMode::DutyCycle => "%",
            _ => "",
        };
        
        (unit.to_string(), is_overflow)
    }
}

impl Default for AnengDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl MultimeterDriver for AnengDriver {
    fn name(&self) -> &'static str {
        "ANENG (AN8008, AN8009, AN870, AN7028, etc.)"
    }
    
    fn driver_type(&self) -> DriverType {
        DriverType::Aneng
    }
    
    async fn connect(&mut self, port: &str) -> Result<(), String> {
        self.state = ConnectionState::Connecting;
        
        match SerialLink::open(port, BAUD_RATE) {
            Ok(link) => {
                log::info!("ANENG conectado en {port} a {BAUD_RATE} baud");
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
        
        let (measure_tx, mut measure_rx) = mpsc::unbounded_channel::<Measurement>();
        let port = link.port_name().to_string();
        
        // `measure_tx` se clona: una copia viaja a la tarea de lectura y la otra
        // queda guardada para poder cerrar el canal en `stop_measurement`.
        let task_tx = measure_tx.clone();
        
        link.start_continuous(
            FRAME_LEN_14,
            boxed_parser(Self::parse_aneng),
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
        let parser = boxed_parser(Self::parse_aneng);
        link.read_frame(FRAME_LEN_14, &parser).await
    }
    
    async fn set_mode(&mut self, mode: MeasurementMode) -> Result<(), String> {
        self.current_mode = mode;
        Ok(())
    }
    
    fn state(&self) -> ConnectionState {
        self.state
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn decodifica_tension() {
        // Modo 0x00 (VoltageDC), rango 1 en los bits altos.
        let f = frame(0x20, [0x00, 0x00, 0x10, 0x00], 0x01, 0x00);
        let m = AnengDriver::parse_aneng(&f).expect("debería parsear");
        
        assert_eq!(m.mode, MeasurementMode::VoltageDC);
        assert_eq!(m.unit, "V");
    }

    #[test]
    fn mapea_duty_cycle() {
        assert_eq!(AnengDriver::decode_mode(0x0A), MeasurementMode::DutyCycle);
    }

    #[test]
    fn detecta_overflow() {
        let f = frame(0x00, [0x00, 0x00, 0x00, 0x00], 0x81, 0x00);
        let m = AnengDriver::parse_aneng(&f).expect("debería parsear");
        assert!(m.is_overflow);
    }

    #[test]
    fn rechaza_header_invalido() {
        let mut f = frame(0x00, [0x00, 0x00, 0x00, 0x00], 0x01, 0x00);
        f[0] = 0x55;
        // ANENG solo acepta 0xAA, a diferencia de Uni-T que también acepta 0x55.
        assert!(AnengDriver::parse_aneng(&f).is_none());
    }

    #[test]
    fn frame_corto_se_rechaza() {
        assert!(AnengDriver::parse_aneng(&[0xAA, 0x00, 0x00]).is_none());
    }

    #[test]
    fn bcd_corrupto_da_nan() {
        let f = frame(0x00, [0x00, 0x0F, 0x00, 0x00], 0x01, 0x00);
        let m = AnengDriver::parse_aneng(&f).expect("parsea el frame");
        assert!(m.value.is_nan());
    }
}