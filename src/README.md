# VolFix — Frontend + Tauri

Estructura del frontend React y del backend Rust de VolFix.

## Scripts

```bash
npm run dev       # Solo el frontend en modo navegador (sin backend Tauri)
npm run tauri dev # App de escritorio completa
npm run build     # Type-check + build de Vite a dist/
npm run tauri build # Empaqueta el ejecutable de Windows
```

## Por qué `npm run dev` solo no sirve

Los comandos `invoke` de `@tauri-apps/api` necesitan la ventana de Tauri. En el
navegador las funciones de `src/utils/tauri.ts` fallan, y `convertFileSrc`
devuelve una URL que no resuelve. Para probar hay que usar `npm run tauri dev`.

## Dónde tocar

| Archivo | Responsabilidad |
|---|---|
| `src/types/index.ts` | Contrato con el backend. Los nombres de enum tienen que coincidir con el `serde` de Rust |
| `src/utils/tauri.ts` | Puente: un wrapper por comando de Rust |
| `src/hooks/useMeasurements.ts` | Suscripción a eventos y sondeo de puertos |
| `src/hooks/useAnnotations.ts` | Puntos de prueba, persistidos por esquemático |
| `src/components/MeasurementPanel.tsx` | UI del panel de mediciones |

## Agregar un modelo de multímetro

1. Copiar `src-tauri/src/usb/drivers/unit_ut.rs` a un archivo nuevo.
2. Implementar el parseo del frame y el mapeo de modo.
3. Registrar el driver en `create_manager()`, en
   `src-tauri/src/usb/mod.rs`.
4. Agregar el VID/PID a `detect_driver_type`.
5. Cubrir el parser con tests en el mismo archivo.

No hace falta tocar la capa de I/O: `usb/protocol.rs` ya resuelve apertura,
lectura continua y parada.