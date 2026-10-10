// Driver SCPI genérico para instrumentos profesionales
// Fluke, Keysight, Rigol, Siglent, Tektronix, Rohde & Schwarz, etc.
//
// A diferencia de Uni-T y ANENG, SCPI es un protocolo de texto: se escriben
// comandos y se leen respuestas terminadas en salto de línea.

use async_trait::async_trait;
use tokio::sync::mpsc;

use crate::usb::drivers::unit_ut::now_millis;
use crate::usb::protocol::{boxed_line_parser, SerialLink, DEFAULT_POLL_INTERVAL};
use crate::usb::{ConnectionState, DriverType, Measurement, MeasurementEvent, MeasurementMode, MultimeterDriver};

/// Baud rate típico por defecto de los instrumentos SCPI de laboratorio.
const BAUD_RATE: u32 = 9600;

/// Identificador de protocolo estándar. Lo usan casi todos los instrumentos.
const SCPI_IDN: &str = "*IDN?";

pub struct SCPIDriver {
    link: Option<SerialLink>,
    state: ConnectionState,
    current_mode: MeasurementMode,
    instrument: Option<String>,
}

impl SCPIDriver {
    pub fn new() -> Self {
        Self {
            link: None,
            state: ConnectionState::Disconnected,
            current_mode: MeasurementMode::VoltageDC,
            instrument: None,
        }
    }

    /// Traduce un modo al comando `CONF:` correspondiente.
    fn mode_command(mode: &MeasurementMode) -> Option<&'static str> {
        Some(match mode {
            MeasurementMode::VoltageDC => "CONF:VOLT:DC",
            MeasurementMode::VoltageAC => "CONF:VOLT:AC",
            MeasurementMode::CurrentDC => "CONF:CURR:DC",
            MeasurementMode::CurrentAC => "CONF:CURR:AC",
            MeasurementMode::Resistance => "CONF:RES",
            MeasurementMode::Continuity => "CONF:CONT:THR 1",
            MeasurementMode::Diode => "CONF:DIOD",
            MeasurementMode::Capacitance => "CONF:CAP",
            MeasurementMode::Frequency => "CONF:FREQ",
            MeasurementMode::Temperature => "CONF:TEMP",
            MeasurementMode::DutyCycle => "CONF:PER:DCYC",
            MeasurementMode::Unknown => return None,
        })
    }

    /// Interpreta una respuesta numérica de SCPI.
    ///
    /// Acepta `1.2345`, `1.2345,V` y `1.2345E-3`. Los prefijos de engineering
    /// (`1.2k`) y el marcador de overload (`OL`, `OVLD`, `+OVLD`) se manejan
    /// aparte porque no parsean como `f64`.
    fn parse_response(&self, response: &str) -> Result<Measurement, String> {
        let cleaned = response.trim();
        if cleaned.is_empty() {
            return Err("El instrumento devolvió una respuesta vacía".to_string());
        }
        
        let upper = cleaned.to_uppercase();
        if upper.contains("OL") || upper.contains("OVLD") || upper.contains("OVERLOAD") {
            return Ok(Measurement {
                timestamp: now_millis(),
                // Se usa INFINITY en vez de un valor inventado: la UI ya sabe
                // mostrar `OL` cuando ve `is_overflow`.
                value: f64::INFINITY,
                unit: self.current_mode.unit().to_string(),
                mode: self.current_mode,
                is_relative: false,
                is_overflow: true,
            });
        }
        
        // `CONF:RES 4.7k` devuelve valor y unidad separados por espacio.
        let (number_part, unit_part) = match cleaned.split_once(char::is_whitespace) {
            Some((n, u)) => (n, Some(u)),
            None => match cleaned.split_once(',') {
                Some((n, u)) => (n, Some(u)),
                None => (cleaned, None),
            },
        };
        
        let (value, scaled_unit) = parse_engineering(number_part)?;
        let unit = unit_part
            .map(|u| u.trim().to_string())
            .filter(|u| !u.is_empty())
            .or(scaled_unit)
            .unwrap_or_else(|| self.current_mode.unit().to_string());
        
        if !value.is_finite() {
            return Err(format!("No se pudo interpretar la respuesta: {cleaned}"));
        }
        
        Ok(Measurement {
            timestamp: now_millis(),
            value,
            unit,
            mode: self.current_mode,
            is_relative: false,
            is_overflow: false,
        })
    }
}

impl Default for SCPIDriver {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl MultimeterDriver for SCPIDriver {
    fn name(&self) -> &'static str {
        "SCPI Genérico (Fluke, Keysight, Rigol, Siglent, Tektronix, R&S, etc.)"
    }
    
    fn driver_type(&self) -> DriverType {
        DriverType::SCPI
    }
    
    async fn connect(&mut self, port: &str) -> Result<(), String> {
        self.state = ConnectionState::Connecting;
        
        let mut link = match SerialLink::open(port, BAUD_RATE) {
            Ok(l) => l,
            Err(e) => {
                self.state = ConnectionState::Error;
                return Err(e);
            }
        };
        
        // Un `*IDN?` fallido significa que el puerto abierto no habla SCPI:
        // casi siempre hay otro driver detrás, o el baud rate está mal.
        // `write_line` y `read_line` van secuenciales: `and_then` receivingía un
        // future ya construido y no awaited, así que hay que resolverlos aparte.
        let idn = match link.write_line(SCPI_IDN).await {
            Ok(()) => link.read_line().await,
            Err(e) => Err(e),
        };

        let idn = match idn {
            Ok(idn) => idn,
            Err(e) => {
                self.state = ConnectionState::Error;
                return Err(format!("{e}. ¿El instrumento habla SCPI a {BAUD_RATE} baud?"));
            }
        };
        
        log::info!("Instrumento SCPI detectado: {idn}");
        self.instrument = Some(idn);
        self.link = Some(link);
        self.state = ConnectionState::Connected;
        Ok(())
    }
    
    async fn disconnect(&mut self) -> Result<(), String> {
        // Se pide apagar la lectura continua antes de cerrar, para que el
        // instrumento no quede emitting datos a un puerto cerrado.
        if let Some(link) = self.link.as_mut() {
            if link.is_reading() {
                let _ = link.write_line("INIT:CONT OFF").await;
            }
            link.close().await;
        }
        self.instrument = None;
        self.state = ConnectionState::Disconnected;
        Ok(())
    }
    
    async fn start_measurement(
        &mut self,
        sink: mpsc::UnboundedSender<MeasurementEvent>,
    ) -> Result<(), String> {
        let link = self.link.as_mut().ok_or("No conectado")?;
        link.write_line("INIT:CONT ON").await?;
        
        let mode = self.current_mode;
        let (measure_tx, mut measure_rx) = mpsc::unbounded_channel::<Measurement>();
        
        // SCPI no hace push: el enlace sondea `FETCH?` con su propio ritmo.
        link.start_polling(
            "FETCH?",
            DEFAULT_POLL_INTERVAL,
            boxed_line_parser(move |line| MeasurementParser { mode }.parse(line).ok()),
            measure_tx,
        );
        
        // Puente de mediciones a eventos para el frontend.
        let instrument = self.instrument.clone().unwrap_or_default();
        tokio::spawn(async move {
            while let Some(measurement) = measure_rx.recv().await {
                if sink.send(MeasurementEvent::MeasurementReceived(measurement)).is_err() {
                    break;
                }
            }
            log::debug!("Puente de mediciones cerrado para {instrument}");
        });
        
        Ok(())
    }
    
    async fn stop_measurement(&mut self) -> Result<(), String> {
        if let Some(link) = self.link.as_mut() {
            link.stop().await;
            let _ = link.write_line("INIT:CONT OFF").await;
        }
        Ok(())
    }
    
    async fn read_single(&mut self) -> Result<Measurement, String> {
        let mode = self.current_mode;
        let link = self.link.as_mut().ok_or("No conectado")?;
        link.write_line("FETCH?").await?;
        let response = link.read_line().await?;
        MeasurementParser { mode }.parse(&response)
    }
    
    async fn set_mode(&mut self, mode: MeasurementMode) -> Result<(), String> {
        let link = self.link.as_mut().ok_or("No conectado")?;
        let cmd = Self::mode_command(&mode)
            .ok_or("Ese modo no tiene equivalente SCPI")?;
        link.write_line(cmd).await?;
        self.current_mode = mode;
        Ok(())
    }
    
    fn state(&self) -> ConnectionState {
        self.state
    }
}

/// Parsea un valor SCPI con prefijo de engineering opcional.
fn parse_engineering(input: &str) -> Result<(f64, Option<String>), String> {
    const PREFIXES: [(char, f64, &str); 9] = [
        ('T', 1e12, "T"), ('G', 1e9, "G"), ('M', 1e6, "M"),
        ('k', 1e3, "k"), ('m', 1e-3, "m"), ('u', 1e-6, "µ"),
        ('n', 1e-9, "n"), ('p', 1e-12, "p"), ('f', 1e-15, "f"),
    ];
    
    let s = input.trim();
    if s.is_empty() {
        return Err("Valor vacío".to_string());
    }
    
    let (number, last) = s.split_at(s.len() - 1);
    // `1.2e3` se parte mal, así que solo se busca prefijo si el último caracter
    // no es parte de un exponente.
    let has_exponent = number.to_lowercase().contains('e');
    
    if let Some((_, factor, unit)) = PREFIXES.iter().find(|(p, _, _)| *p == last.chars().next().unwrap_or('\0')) {
        if !has_exponent && !number.is_empty() {
            if let Ok(v) = number.parse::<f64>() {
                return Ok((v * factor, Some(unit.to_string())));
            }
        }
    }
    
    s.parse::<f64>()
        .map(|v| (v, None))
        .map_err(|_| format!("Valor no numérico: {s}"))
}

/// Estado de parseo compartido por la lectura única y la continua.
struct MeasurementParser {
    mode: MeasurementMode,
}

impl MeasurementParser {
    fn parse(&self, response: &str) -> Result<Measurement, String> {
        let driver = SCPIDriver {
            link: None,
            state: ConnectionState::Disconnected,
            current_mode: self.mode,
            instrument: None,
        };
        driver.parse_response(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parser(mode: MeasurementMode) -> SCPIDriver {
        SCPIDriver {
            link: None,
            state: ConnectionState::Disconnected,
            current_mode: mode,
            instrument: None,
        }
    }

    #[test]
    fn parsea_un_valor_simple() {
        let d = parser(MeasurementMode::VoltageDC);
        let m = d.parse_response("1.2345").unwrap();
        assert_eq!(m.value, 1.2345);
        assert_eq!(m.unit, "V");
    }

    #[test]
    fn parsea_valor_con_unidad_por_coma() {
        let d = parser(MeasurementMode::VoltageDC);
        let m = d.parse_response("3.3,V").unwrap();
        assert_eq!(m.value, 3.3);
        assert_eq!(m.unit, "V");
    }

    #[test]
    fn parsea_valor_con_unidad_por_espacio() {
        let d = parser(MeasurementMode::CurrentDC);
        let m = d.parse_response("0.125 A").unwrap();
        assert_eq!(m.value, 0.125);
        assert_eq!(m.unit, "A");
    }

    #[test]
    fn parsea_prefijo_de_engineering() {
        let (v, u) = parse_engineering("4.7k").unwrap();
        assert!((v - 4700.0).abs() < f64::EPSILON);
        assert_eq!(u.as_deref(), Some("k"));
    }

    #[test]
    fn parsea_prefijo_micro() {
        let (v, u) = parse_engineering("220u").unwrap();
        assert!((v - 0.00022).abs() < 1e-12);
        assert_eq!(u.as_deref(), Some("µ"));
    }

    #[test]
    fn no_confunde_exponente_con_prefijo() {
        // `1e3` son mil, no 1 con prefijo 'e'.
        let (v, u) = parse_engineering("1e3").unwrap();
        assert!((v - 1000.0).abs() < f64::EPSILON);
        assert_eq!(u, None);
    }

    #[test]
    fn detecta_overload() {
        let d = parser(MeasurementMode::Resistance);
        let m = d.parse_response("OL").unwrap();
        assert!(m.is_overflow);
        assert!(m.value.is_infinite());
    }

    #[test]
    fn detecta_overload_con_prefijo() {
        let d = parser(MeasurementMode::VoltageDC);
        assert!(d.parse_response("+OVLD").unwrap().is_overflow);
    }

    #[test]
    fn rechaza_respuesta_vacia() {
        let d = parser(MeasurementMode::VoltageDC);
        assert!(d.parse_response("   ").is_err());
    }

    #[test]
    fn rechaza_texto_no_numerico() {
        let d = parser(MeasurementMode::VoltageDC);
        assert!(d.parse_response("ERROR").is_err());
    }

    #[test]
    fn mapea_modos_a_comandos() {
        assert_eq!(SCPIDriver::mode_command(&MeasurementMode::VoltageDC), Some("CONF:VOLT:DC"));
        assert_eq!(SCPIDriver::mode_command(&MeasurementMode::Diode), Some("CONF:DIOD"));
        assert_eq!(SCPIDriver::mode_command(&MeasurementMode::Unknown), None);
    }
}