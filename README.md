# VolFix

Software de diagnóstico en tiempo real para reparación de dispositivos móviles.

## Qué es VolFix

VolFix es una herramienta de escritorio para técnicos en electrónica que reparan
celulares. Combina la carga de esquemáticos propios con medición en tiempo real
mediante un multímetro conectado por USB.

## Qué lo hace diferente

A diferencia de herramientas como Borneo Schematics, VolFix no depende de una
base de datos cerrada. El técnico carga sus propios esquemáticos y el software
los convierte en una herramienta de diagnóstico interactiva.

## Características

- Carga de esquemáticos propios (PDF, PNG, JPG, BMP, WEBP)
- Visor de PDF y de imágenes con zoom, pan y ajuste a la ventana
- Puntos de prueba marcados sobre el esquemático, con rango esperado por punto
- Conexión USB con multímetros Uni-T, ANENG e instrumentos SCPI
- Medición continua y lectura única, con historial y exportación a CSV
- Lectura en vivo superpuesta sobre el punto que se está midiendo
- Casos de diagnóstico por esquemático, con archivado de mediciones
- Detección automática del modelo, con selección manual como respaldo

## Estado del proyecto

Etapa 1 (visor de esquemáticos) completa. Etapa 2 (integración USB) con los tres
drivers implementados y probados a nivel de parsing; falta validarlos contra
hardware real y agregar los conectores de carga.

## Requisitos

- Windows 10 u superior
- Node.js 20 o superior
- Rust estable con las herramientas de MSVC
- Visual Studio Build Tools con el workload de C++ (lo exige WebView2)

## Desarrollo

```bash
# Dependencias del frontend
cd src
npm install

# Levantar la app en modo desarrollo
npm run tauri dev
```

## Verificación

```bash
# Frontend: tipos, tests y build
cd src
npx tsc --noEmit
npm test
npm run build

# Backend: tests y análisis estático
cd src/src-tauri
cargo test --lib
cargo clippy --all-targets
```

## Arquitectura

```
src/
  src/                    Frontend React + TypeScript
    components/           Visores, editor de rango, panel de mediciones
    hooks/                Estado: esquemáticos, anotaciones, mediciones, casos
    types/                Tipos compartidos con el backend
    utils/annotations.ts   Formato y comparación de rangos, compartido por ambos visores
    utils/pdfCoordinates.ts Traducción entre coordenadas de página y de pantalla
    utils/tauri.ts        Puente hacia los comandos Rust
  src-tauri/
    src/usb/
      mod.rs              Manager de dispositivos, trait y tipos
      protocol.rs         Transporte serial compartido por los drivers
      drivers/            Uni-T, ANENG y SCPI
      manager.rs          Comandos Tauri
    capabilities/         Permisos de Tauri 2
```

Los drivers comparten toda la capa de I/O en `usb/protocol.rs`: cada uno define
solo cómo se parsea su protocolo. Agregar un modelo nuevo es escribir un
`parse` y un `mode_command`.

Los dos visores comparten `utils/annotations.ts` y `components/annotations.css`:
el formato de un valor y la comparación contra el rango esperado tienen que dar
el mismo resultado se mire un PDF o una imagen, y el CSS de los puntos vivía
en `ImageViewer.css`, así que el visor de PDF los heredaba solo por el orden de
importación del bundle.

## Hardware compatible

| Driver | Protocolo | Baud | Modelos de referencia |
|---|---|---|---|
| Uni-T | 14 bytes binario | 2400 | UT61E, UT171B, UT181A, UT33C |
| ANENG | 14 bytes binario | 2400 | AN8008, AN8009, AN870, AN7028 |
| SCPI | Texto, comandos `CONF:`/`FETCH?` | 9600 | Fluke, Keysight, Rigol, Siglent, Tektronix, R&S |

Uni-T y ANENG cambian de modo con el selector físico del instrumento: la
selección de modo en la UI es informativa para esos modelos.

## Licencia

Proyecto en desarrollo. Todos los derechos reservados por GS-Smartfix.