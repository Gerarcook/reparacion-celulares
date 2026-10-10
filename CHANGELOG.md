# VolFix - Changelog

## [No publicado]

### Agregado
- Los puntos de prueba ahora se dibujan sobre el PDF. Antes se guardaban pero
  no se renderizaban: el visor de PDF no mostraba ni un punto, y `pageAnnotations`
  solo se usaba para contar. El overlay sigue el zoom de la página
- Formulario de rango esperado por punto, que era la pieza que faltaba:
  `Annotation.expected` ya lo leían los visores pero nada lo escribía, y
  `updateAnnotation` estaba implementado sin usarse. Valida rango invertido y
  propone el rango de la lectura actual ±5%
- Casos de diagnóstico persistidos por esquemático (`useCases`), con estado
  y archivado del historial de mediciones. El tipo `Case` existía sin uso
- Tests del frontend con `vitest` (`npm test`): 20 casos sobre la lógica de rango
  y la matemática del overlay de PDF. La lógica de rango decide si el técnico ve
  rojo o verde, y el overlay ya tuvo un error de escala que ningún typecheck
  detectaba

### Corregido
- `.gitignore` en la raíz. El CHANGELOG anterior afirmaba que existía; solo
  estaba `src/.gitignore`, que no alcanzaba fuera de `src/`
- El overlay de puntos del PDF aplicaba una compensación de zoom de más: el
  canvas de pdf.js ya viene escalado por `scale`, y encima el overlay dividía
  otra vez. Los puntos caían a `página / scale²` de su lugar — invisible a
  escala 1 y 16x desviado a escala 4. Ahora las dos conversiones viven en
  `utils/pdfCoordinates.ts`, que es el único lugar donde se traduce entre
  coordenadas de página y de pantalla
- La lectura viva se pintaba sobre todos los puntos a la vez, así que con
  cinco puntos marcados el técnico veía el mismo voltaje repetido. Ahora se
  atribuye al punto seleccionado o al último marcado
- En overflow no hay número que comparar contra el rango: el valor ya no se
  muestra ni marca el punto como fuera de rango
- El CSS de los puntos vivía en `ImageViewer.css`. `PDFViewer` no lo importaba
  y heredaba los estilos por el orden de importación del bundle; movido a
  `components/annotations.css`, que importan los dos visores
- El estado de las mediciones se subió de `MeasurementPanel` a `App`, porque
  los casos archivan el historial y el panel no es accesible desde `App`
- Un rango invertido (`min > max`) se guardaba y marcaba todos los puntos como
  fuera de rango sin avisar; ahora el formulario lo rechaza
- Se limpia la selección de punto al cambiar de esquemático o al borrar el
  punto seleccionado, para no dejar referencias colgando

### Pendiente
- Validar los protocolos contra hardware real
- Conectores de carga de celulares y puntas de tester
- Validar los drivers contra hardware real

## [0.2.0]

### Agregado
- Visor de PDF real con `react-pdf`: navegación por páginas, zoom y capa de
  texto para buscar y copiar etiquetas del esquemático
- Puntos de prueba sobre el esquemático con rango esperado y lectura en vivo
  superpuesta, tanto en el visor de imágenes como en el de PDF
- Persistencia de anotaciones por esquemático (`useAnnotations`)
- Lectura única por comando, independiente de la medición continua
- Detección de plugged/unplugged por sondeo del backend, con limpieza de
  conexiones muertas
- Selección manual del modelo cuando la autodetección falla
- Exportación a CSV con BOM UTF-8 para que Excel respete las unidades
- Limpieza de puertos COM al cerrar la ventana
- Tests unitarios: parsing de los tres protocolos, autodetección de driver y
  contrato de serialización de enums

### Corregido
- El proyecto no compilaba: 13 errores. Módulo `protocol` declarado sin
  archivo, shadowing de `port` con valores movidos, trait
  `SerialPortBuilderExt` sin importar, `read_exact` con `AsyncBufReadExt` en
  lugar de `AsyncReadExt`
- Panic en el arranque: el estado se registraba como `DeviceManager` pelado y
  se pedía `Arc<DeviceManagerState>`
- Las mediciones nunca llegaban al frontend. El canal del driver no estaba
  conectado al del manager y la tarea spawneada mandaba valores cero
- Los enums se serializaban como `voltagedc` y `unitut`; el frontend esperaba
  `voltage_dc` y `unit_ut`. Ahora `snake_case`, con test que lo fija
- El driver se removía del pool al conectar, así que un segundo puerto del
  mismo modelo fallaba. Ahora hay fábricas de drivers
- `stop_measurement` abortaba la tarea sin recuperar el lector, dejando el
  enlace inutilizable. Ahora la tarea devuelve sus mitades al terminar
- `asset://` sin configurar: las imágenes no se veían. Agregado
  `protocol-asset` en Cargo.toml, `convertFileSrc` en el frontend y scope en
  `tauri.conf.json`
- Sin archivo de capacidades: `dialog` y `fs` no tenían permisos
- CSP en `null`
- Las anotaciones se perdían al cambiar de vista
- Las fechas se guardaban como `Date` en localStorage y volvían como string

### Técnico
- Capa de transporte serial compartida (`usb/protocol.rs`). Cada driver define
  solo su parsing; agregar un modelo es escribir un `parse` y un `mode_command`
- Mensajes de error accionables en lugar de "Error: no implementado"
- `.gitignore` en la raíz, cubriendo `node_modules` y `target/`
- Detección de BCD corrupto: un dígito mayor que 9 devuelve `NaN` en vez de
  un número plausible pero falso
- Parser SCPI con prefijos de engineering, notación exponencial y markers de
  overload

### Pendiente
- Validar los protocolos contra hardware real
- Formulario de rango esperado por punto
- Superponer la lectura en vivo sobre el punto marcado
- Conectores de carga de celulares
- Historial de casos con persistencia

## [0.1.0] - 2026-10-03

### Agregado
- Estructura base del proyecto con Tauri + React + TypeScript
- Sistema de carga de archivos (PDF e imágenes) con diálogo nativo
- Visor de imágenes con zoom/pan interactivo
- Hook `useSchematics` para manejo de estado
- Panel lateral de mediciones (UI preparada para integración USB)
- Historial de esquemáticos recientes con localStorage
- Placeholder para visor de PDF
- Estilos modernos con tema oscuro

### Técnico
- Configuración Tauri 2.0 con plugins: Dialog, FileSystem, Shell
- Build system con Vite
- TypeScript estricto configurado
- Estructura modular: components, hooks, types, utils