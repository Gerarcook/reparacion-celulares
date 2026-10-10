
# VolFix — Plan de Etapas

## Etapa 1 — Software base (MVP)

Objetivo: tener un software funcional de escritorio que permita cargar
y visualizar esquemáticos de forma interactiva.

### Funcionalidades
- Carga de esquemáticos en formato PDF e imagen
- Navegación y zoom sobre el esquemático
- Herramientas básicas de anotación y marcado de puntos
- Interfaz limpia y moderna orientada al técnico
- Historial de dispositivos y casos

### Criterio de éxito
Un técnico puede abrir su esquemático en VolFix y trabajar
con él de forma más cómoda que con un visor de PDF común.

---

## Etapa 2 — Integración de hardware USB

Objetivo: conectar hardware periférico al software para medición en tiempo real.

### Funcionalidades
- Comunicación USB con módulo de adquisición de datos (DAQ)
- Soporte para puntas de tester
- Soporte para conectores de carga de celulares
- Visualización de mediciones en tiempo real sobre el esquemático
- Alertas y rangos de valores esperados por punto de prueba

### Criterio de éxito
El técnico conecta las puntas al celular y ve los valores
reflejados en tiempo real directamente sobre el esquemático cargado.

---

## Etapa 3 — Asistente IA (Jarvis)

Objetivo: integrar un asistente de inteligencia artificial que interprete
las mediciones y guíe el diagnóstico.

### Funcionalidades
- Interpretación automática de mediciones en contexto
- Sugerencias de posibles fallas basadas en los valores obtenidos
- Chat interactivo con el técnico durante el diagnóstico
- Aprendizaje basado en casos reales registrados
- Generación automática de informes de diagnóstico

### Criterio de éxito
El asistente sugiere correctamente la falla en base a las mediciones
sin que el técnico tenga que interpretar los valores manualmente.

---

## Etapa 4 — Comercialización

Objetivo: llevar VolFix al mercado como producto comercial.

### Acciones
- Definición del modelo de negocio (licencia, suscripción, hardware + software)
- Diseño del hardware definitivo para distribución
- Sitio web y materiales de marketing
- Documentación técnica para usuarios
- Soporte y actualizaciones

### Criterio de éxito
Primeras ventas reales y feedback de técnicos externos al proyecto.

---

## Estado actual

**Etapa 1 — Completa.** Visor de PDF e imágenes con zoom, pan, puntos de prueba
persistentes y exportación de historial.

**Etapa 2 — En progreso.** Los tres drivers (Uni-T, ANENG, SCPI) están
implementados y cubiertos con tests de parsing. La comunicación USB funciona;
falta lo siguiente:

- Validar los protocolos contra hardware real. Los parsers están escritos a
  partir de documentación pública y necesitan contraste con lecturas físicas.
- Conectores de carga de celulares y puntas de tester. No empezado.

Lo que ya está resuelto en esta etapa:

- Puntos de prueba dibujados sobre el PDF, con overlay que se descala solo para
  no descolocarse al hacer zoom
- Lectura en vivo atribuida al punto que el técnico está mirando, no repetida
  en todos los puntos
- Formulario de rango esperado por punto, con validación de rango invertido y
  propuesta de rango a partir de la lectura actual
- Casos de diagnóstico persistidos por esquemático, con archivado del historial
  de mediciones

**Etapa 3 — No empezada.**

**Etapa 4 — No empezada.**

## Proyecto

Desarrollado por GS-Smartfix en cowork con el asistente virtual Jarvis.
