// Capa de transporte serial compartida por todos los drivers.
//
// Cada driver define *qué* significa un frame (el parsing) pero no *cómo* se
// abre el puerto ni cómo se mantiene la lectura continua. Ese trabajo vive acá
// y evita triplicar el mismo código de I/O en cada driver.

use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;
use tokio_serial::{SerialPortBuilderExt, SerialStream};

use crate::usb::Measurement;

/// Convierte un frame crudo en una medición, o `None` si el frame no es válido.
pub type FrameParser = Arc<dyn Fn(&[u8]) -> Option<Measurement> + Send + Sync>;

/// Convierte una línea de texto en una medición, o `None` si no es válida.
pub type LineParser = Arc<dyn Fn(&str) -> Option<Measurement> + Send + Sync>;

/// Intervalo por defecto entre sondeos de un protocolo de texto.
///
/// Con 100 ms se llega a 10 lecturas por segundo: suficiente para ver una
/// variación de tensión y más rápido que el origen, ya que la mayoría de los
/// multílmetros SCPI refrescan a 10 Hz.
pub const DEFAULT_POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Tamaño de frame que usan los protocolos Uni-T y ANENG.
pub const FRAME_LEN_14: usize = 14;

/// Conexión serial abierta, con lector y escritor separados.
///
/// El lector puede moverse a una tarea de fondo para lectura continua; por eso
/// vive en un `Option` y nunca se expone directamente.
pub struct SerialLink {
    port_name: String,
    reader: Option<BufReader<ReadHalf<SerialStream>>>,
    writer: Option<WriteHalf<SerialStream>>,
    /// Tarea de lectura en curso, si la hay.
    read_task: Option<ReadTask>,
}

impl SerialLink {
    /// Abre el puerto en modo asíncrono.
    ///
    /// `baud_rate` sigue el valor típico del fabricante: 2400 para los
    /// multímetros Uni-T y ANENG, 9600 para la mayoría de los instrumentos SCPI.
    pub fn open(port: &str, baud_rate: u32) -> Result<Self, String> {
        let stream = tokio_serial::new(port, baud_rate)
            .data_bits(tokio_serial::DataBits::Eight)
            .parity(tokio_serial::Parity::None)
            .stop_bits(tokio_serial::StopBits::One)
            .timeout(Duration::from_millis(1000))
            .open_native_async()
            .map_err(|e| format!("No se pudo abrir {port}: {e}"))?;

        let (reader, writer) = tokio::io::split(stream);

        Ok(Self {
            port_name: port.to_string(),
            reader: Some(BufReader::new(reader)),
            writer: Some(writer),
            read_task: None,
        })
    }

    pub fn port_name(&self) -> &str {
        &self.port_name
    }

    pub fn is_reading(&self) -> bool {
        self.read_task.is_some()
    }

    /// Escribe una cadena terminada en salto de línea (protocolos de texto).
    pub async fn write_line(&mut self, line: &str) -> Result<(), String> {
        let writer = self.writer.as_mut().ok_or("Puerto no abierto")?;
        writer
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        writer.write_all(b"\n").await.map_err(|e| e.to_string())?;
        writer.flush().await.map_err(|e| e.to_string())
    }

    /// Lee una línea terminada en `\n`. Solo para protocolos de texto (SCPI).
    pub async fn read_line(&mut self) -> Result<String, String> {
        let reader = self.reader.as_mut().ok_or("Puerto no abierto")?;
        let mut line = String::new();
        let n = reader.read_line(&mut line).await.map_err(|e| e.to_string())?;
        if n == 0 {
            return Err("El dispositivo cerró la conexión".to_string());
        }
        Ok(line.trim().to_string())
    }

    /// Lee un frame de tamaño fijo y lo parsea.
    ///
    /// Requiere que no haya una lectura continua activa: [`Self::start_continuous`]
    /// toma posesión del lector mientras corre.
    pub async fn read_frame(&mut self, frame_len: usize, parser: &FrameParser) -> Result<Measurement, String> {
        if self.is_reading() {
            return Err("Detené la medición continua antes de leer un frame puntual".to_string());
        }

        let reader = self.reader.as_mut().ok_or("Puerto no abierto")?;
        let mut frame = vec![0u8; frame_len];

        reader
            .read_exact(&mut frame)
            .await
            .map_err(|e| describe_read_error(&e))?;

        parser(&frame).ok_or_else(|| "Datos inválidos: el dispositivo no envió un frame reconocible".to_string())
    }

    /// Arranca la lectura continua de frames binarios en segundo plano.
    ///
    /// El lector se mueve a la tarea mientras corre. [`Self::stop`] lo devuelve,
    /// así que la lectura puntual sigue disponible después de parar.
    pub fn start_continuous(&mut self, frame_len: usize, parser: FrameParser, sink: mpsc::UnboundedSender<Measurement>) {
        if self.read_task.is_some() {
            return;
        }

        let Some(reader) = self.reader.take() else {
            return;
        };

        let (stop_tx, stop_rx) = oneshot::channel();

        let task = tokio::spawn(async move {
            let mut reader = reader;
            let mut stop_rx = stop_rx;
            let mut frame = vec![0u8; frame_len];

            loop {
                // `select!` sobre el frame completo y la señal de parada: sin
                // esto la tarea quedaría bloqueada en un `read_exact` que puede
                // no llegar nunca y `stop` no podría collecting el reader.
                let read = tokio::select! {
                    biased;
                    _ = &mut stop_rx => break,
                    r = reader.read_exact(&mut frame) => r,
                };

                match read {
                    Ok(_) => {
                        if let Some(measurement) = parser(&frame) {
                            // Si el frontend se desconectó el canal se cierra y
                            // `send` falla: es momento de terminar la tarea.
                            if sink.send(measurement).is_err() {
                                break;
                            }
                        }
                    }
                    Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {
                        // Timeout esperado entre lecturas: se sigue esperando.
                        continue;
                    }
                    Err(e) => {
                        log::warn!("Error leyendo del puerto: {e}");
                        break;
                    }
                }
            }

            // Se devuelve el lector para que `stop` lo recupere. En protocolo binario
            // el escritor nunca salió del enlace, así que no viaja con él.
            RecoveredParts { reader: Some(reader), writer: None }
        });

        self.read_task = Some(ReadTask { handle: task, stop_tx });
    }

    /// Arranca el sondeo periódico de un protocolo de texto (SCPI).
    ///
    /// SCPI no hace push: hay que preguntar con `command` y leer la respuesta.
    /// Se guarda el intervalo para no saturar el bus del instrumento.
    pub fn start_polling(
        &mut self,
        command: &'static str,
        interval: Duration,
        parser: LineParser,
        sink: mpsc::UnboundedSender<Measurement>,
    ) {
        if self.read_task.is_some() {
            return;
        }

        let (Some(reader), Some(mut writer)) = (self.reader.take(), self.writer.take()) else {
            return;
        };

        let (stop_tx, stop_rx) = oneshot::channel();

        let task = tokio::spawn(async move {
            let mut reader = reader;
            let mut stop_rx = stop_rx;
            // `interval` dispara el primer tick al instante; ese primer tick se
            // descarta para no interrogar al instrumento antes de que el técnico
            // haya visto la conexión.
            let mut ticker = tokio::time::interval(interval);
            // La primera versión del ticker dispara de inmediato; se descarta
            // para no leer antes de que el técnico haya tenido tiempo de ver
            // la conexión.
            ticker.tick().await;

            loop {
                tokio::select! {
                    biased;
                    _ = &mut stop_rx => break,
                    _ = ticker.tick() => {}
                }

                if writer.write_all(command.as_bytes()).await.is_err()
                    || writer.write_all(b"\n").await.is_err()
                    || writer.flush().await.is_err()
                {
                    break;
                }

                let mut line = String::new();
                match tokio::io::AsyncBufReadExt::read_line(&mut reader, &mut line).await {
                    Ok(0) => break,
                    Ok(_) => {
                        if let Some(m) = parser(line.trim()) {
                            if sink.send(m).is_err() {
                                break;
                            }
                        }
                    }
                    Err(e) => {
                        log::warn!("Error en sondeo SCPI: {e}");
                        break;
                    }
                }
            }

            // Se devuelve el par completo para que `stop` lo recupere.
            RecoveredParts { reader: Some(reader), writer: Some(writer) }
        });

        self.read_task = Some(ReadTask { handle: task, stop_tx });
    }

    /// Detiene la tarea de lectura en curso y recupera lector y escritor.
    pub async fn stop(&mut self) {
        let Some(task) = self.read_task.take() else {
            return;
        };

        // Se avisa primero para que la tarea termine por `select!` en vez de
        // quedarse bloqueada en una lectura que puede no llegar nunca.
        let _ = task.stop_tx.send(());

        match task.handle.await {
            Ok(parts) => {
                if self.reader.is_none() {
                    self.reader = parts.reader;
                }
                if self.writer.is_none() {
                    self.writer = parts.writer;
                }
            }
            // La tarea terminó con error o fue abortada: el reader y el writer
            // se perdieron con ella. Es el precio de moverlos a la tarea; por eso
            // las lecturas continuas tienen que detenerse antes de cerrar.
            Err(e) => log::warn!("La tarea de lectura terminó con error: {e}"),
        }
    }

    /// Cierra el puerto. Si hay lectura en curso, la detiene primero.
    pub async fn close(&mut self) {
        self.stop().await;
        self.writer = None;
        self.reader = None;
    }
}

/// Mitades del enlace recuperadas al terminar una tarea de lectura.
///
/// El escritor es `None` en protocolo binario: ahí la tarea solo toma el
/// lector y el escritor nunca salió del enlace.
pub struct RecoveredParts {
    reader: Option<BufReader<ReadHalf<SerialStream>>>,
    writer: Option<WriteHalf<SerialStream>>,
}

/// Tarea de lectura en curso. El handle devuelve las mitades al terminar.
struct ReadTask {
    handle: JoinHandle<RecoveredParts>,
    stop_tx: oneshot::Sender<()>,
}

/// Envuelve un parser de frames en el tipo que espera `start_continuous`.
pub fn boxed_parser<F>(f: F) -> FrameParser
where
    F: Fn(&[u8]) -> Option<Measurement> + Send + Sync + 'static,
{
    Arc::new(f)
}

/// Envuelve un parser de líneas en el tipo que espera `start_polling`.
pub fn boxed_line_parser<F>(f: F) -> LineParser
where
    F: Fn(&str) -> Option<Measurement> + Send + Sync + 'static,
{
    Arc::new(f)
}

/// Traduce un error de lectura a algo que el técnico pueda entender.
fn describe_read_error(e: &std::io::Error) -> String {
    match e.kind() {
        std::io::ErrorKind::TimedOut => {
            "Timeout: el dispositivo no respondió. Revisá el selector de modo.".to_string()
        }
        std::io::ErrorKind::UnexpectedEof => {
            "Frame incompleto: se esperaba un paquete de tamaño fijo.".to_string()
        }
        _ => e.to_string(),
    }
}