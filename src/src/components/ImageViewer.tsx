import { useCallback, useRef, useState } from "react";
import { toAssetUrl } from "../utils/tauri";
import { describeRange, formatReading, isOutOfRange } from "../utils/annotations";
import type { Annotation } from "../types";
import { RangeEditor } from "./RangeEditor";
import "./annotations.css";
import "./ImageViewer.css";

interface ImageViewerProps {
  imagePath: string;
  imageName: string;
  annotations: Annotation[];
  onAddAnnotation: (annotation: Annotation) => void;
  onRemoveAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  /** Punto seleccionado. Vive en `App` para poder atribuirle la lectura viva. */
  selectedId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  /**
   * Última medición viva y el punto al que pertenece.
   *
   * Antes se pintaba en todos los puntos a la vez: con cinco puntos marcados el
   * técnico veía el mismo voltaje repetido y no sabía cuál estaba midiendo.
   */
  liveReading?: number | null;
  liveUnit?: string;
  liveAnnotationId?: string | null;
}

const MIN_SCALE = 0.1;
const MAX_SCALE = 10;

/** Convierte un evento de rueda en un factor de zoom estable entre navegadores. */
function wheelFactor(deltaY: number): number {
  return deltaY > 0 ? 0.9 : 1.1;
}

export function ImageViewer({
  imagePath,
  imageName,
  annotations,
  onAddAnnotation,
  onRemoveAnnotation,
  onUpdateAnnotation,
  selectedId,
  onSelectAnnotation,
  liveReading,
  liveUnit,
  liveAnnotationId,
}: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragOrigin = useRef({ x: 0, y: 0 });

  const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));

  const resetView = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const zoomIn = () => setScale((prev) => clamp(prev * 1.2));
  const zoomOut = () => setScale((prev) => clamp(prev / 1.2));

  const zoomToFit = useCallback(() => {
    const container = containerRef.current;
    const img = container?.querySelector("img");
    if (!container || !img) return;

    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const iw = img.naturalWidth;
    const ih = img.naturalHeight;
    if (!iw || !ih) return;

    setScale(clamp(Math.min(cw / iw, ch / ih) * 0.95));
    setPosition({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => clamp(prev * wheelFactor(e.deltaY)));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Solo el botón principal panifica; el derecho abre el menú contextual.
    if (e.button !== 0) return;

    if (isAnnotating) {
      // Se usa el rect del `<img>` y no el del contenedor: el rect del
      // `<img>` ya tiene el zoom y el desplazamiento aplicados, así que
      // dividir por la escala da la coordenada real de la imagen sin tener que
      // reconstruir la transformación a mano.
      const img = containerRef.current?.querySelector("img");
      const rect = img?.getBoundingClientRect();
      if (!rect) return;

      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      const label = window.prompt("Etiqueta del punto de prueba:");
      if (label?.trim()) {
        const id = crypto.randomUUID();
        onAddAnnotation({
          id,
          point: { x, y },
          label: label.trim(),
          color: "#ff6b6b",
          timestamp: new Date().toISOString(),
        });
        // Un punto recién marcado es el que el técnico está por medir: la
        // lectura viva pasa a atribuirse a él.
        onSelectAnnotation(id);
      }
      return;
    }

    setIsDragging(true);
    // Se guarda el delta del clic al origen del pan: mover después usa esta
    // referencia en vez del estado, así no se arrastra un frame de atraso.
    dragOrigin.current = { x: e.clientX - position.x, y: e.clientY - position.y };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || isAnnotating) return;
    setPosition({
      x: e.clientX - dragOrigin.current.x,
      y: e.clientY - dragOrigin.current.y,
    });
  };

  const handleMouseUp = () => setIsDragging(false);

  /** Lleva la imagen al punto de una anotación y la selecciona. */
  const focusAnnotation = useCallback(
    (annotation: Annotation) => {
      onSelectAnnotation(annotation.id);
      const container = containerRef.current;
      const img = container?.querySelector("img");
      if (!container || !img) return;

      // El contenedor está centrado con un -50%, así que para dejar el punto en
      // el medio de la ventana hay que compensar media imagen escalada además
      // del offset del punto.
      const halfW = (img.naturalWidth || container.clientWidth) * scale / 2;
      const halfH = (img.naturalHeight || container.clientHeight) * scale / 2;

      setPosition({
        x: container.clientWidth / 2 - annotation.point.x * scale + halfW,
        y: container.clientHeight / 2 - annotation.point.y * scale + halfH,
      });
    },
    [scale, onSelectAnnotation]
  );

  const cursor = isAnnotating ? "crosshair" : isDragging ? "grabbing" : "grab";

  // El punto abierto en el editor de rango. Puede quedar deseleccionado al
  // borrar el punto que se estaba editando.
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="image-viewer">
      <div className="viewer-toolbar">
        <button onClick={zoomOut} title="Alejar" aria-label="Alejar">
          −
        </button>
        <button onClick={resetView} title="Resetear vista" aria-label="Resetear vista">
          ⟲
        </button>
        <button onClick={zoomIn} title="Acercar" aria-label="Acercar">
          +
        </button>
        <button onClick={zoomToFit} title="Ajustar a la ventana" aria-label="Ajustar a la ventana">
          ⤢
        </button>
        <span className="zoom-level">{Math.round(scale * 100)}%</span>
        <button
          onClick={() => setIsAnnotating((v) => !v)}
          className={isAnnotating ? "active" : ""}
          title={isAnnotating ? "Salir del modo anotación" : "Marcar punto de prueba"}
        >
          {isAnnotating ? "Cancelar" : "Anotar"}
        </button>
        <span className="viewer-hint">
          {isAnnotating ? "Clic para marcar un punto" : "Arrastrá para mover · rueda para zoom"}
        </span>
      </div>

      <div
        ref={containerRef}
        className="viewer-canvas"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor }}
      >
        <div
          className="image-container"
          style={{
            // El -50% centra la imagen; el desplazamiento del técnico se suma.
            // Así `left`/`top` de las anotaciones siguen siendo coordenadas de
            // la imagen, no de la pantalla.
            transform: `translate(calc(-50% + ${position.x}px), calc(-50% + ${position.y}px)) scale(${scale})`,
          }}
        >
          {loadError ? (
            <div className="viewer-error">
              <h3>No se pudo cargar el esquemático</h3>
              <p>{loadError}</p>
              <code>{imagePath}</code>
            </div>
          ) : (
            <img
              src={toAssetUrl(imagePath)}
              alt={imageName}
              draggable={false}
              onLoad={() => setLoadError(null)}
              onError={() =>
                setLoadError(
                  "Verificá que el archivo siga en esa ubicación o volvé a cargarlo."
                )
              }
            />
          )}

          {annotations.map((annotation) => {
            const selected = annotation.id === selectedId;
            const isLiveTarget = annotation.id === liveAnnotationId;

            // La lectura viva tiene prioridad sobre la última guardada: es más
            // reciente, y el valor congelado puede ser de hace media hora.
            const value = isLiveTarget ? liveReading : annotation.lastReading?.value;
            const unit = isLiveTarget ? liveUnit : annotation.lastReading?.unit;
            const overflow = isLiveTarget ? false : annotation.lastReading?.is_overflow;

            const outOfRange =
              value != null &&
              Number.isFinite(value) &&
              !overflow &&
              isOutOfRange(annotation, value);

            return (
              <div
                key={annotation.id}
                className={`annotation-point ${selected ? "selected" : ""} ${outOfRange ? "out-of-range" : ""} ${isLiveTarget ? "live" : ""}`}
                style={{
                  left: annotation.point.x,
                  top: annotation.point.y,
                  borderColor: outOfRange ? "#ff4757" : annotation.color,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  focusAnnotation(annotation);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemoveAnnotation(annotation.id);
                }}
                title={`${annotation.label}${value != null ? `: ${formatReading(value)}${unit ?? ""}` : ""}`}
              >
                <span className="annotation-label">{annotation.label}</span>

                {/* Valor medido, solo sobre el punto que el técnico está mirando. */}
                {value != null && (
                  <span className="annotation-reading">
                    {overflow ? "OL" : formatReading(value) + (unit ?? "")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {annotations.length > 0 && (
        <div className="annotations-panel">
          <h4>Puntos de prueba ({annotations.length})</h4>
          <ul>
            {annotations.map((a) => {
              const hasRange = describeRange(a) !== "";
              const outOfRange =
                !a.lastReading?.is_overflow && isOutOfRange(a, a.lastReading?.value ?? NaN);

              return (
                <li key={a.id} className={a.id === selectedId ? "selected" : ""}>
                  <button
                    className="annotation-select"
                    onClick={() => focusAnnotation(a)}
                    title="Ir al punto"
                  >
                    {a.label}
                  </button>
                  {hasRange ? (
                    <span
                      className={`annotation-range ${outOfRange ? "out-of-range" : ""}`}
                      title={outOfRange ? "La última lectura se salió del rango" : undefined}
                    >
                      {describeRange(a)}
                    </span>
                  ) : (
                    <span
                      className="annotation-range none"
                      title="Sin rango esperado: la lectura no se compara contra nada"
                    >
                      sin rango
                    </span>
                  )}
                  <button
                    onClick={() => onRemoveAnnotation(a.id)}
                    title="Eliminar punto"
                    aria-label={`Eliminar ${a.label}`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>

          {selected && (
            <RangeEditor
              annotation={selected}
              liveReading={liveReading}
              liveUnit={liveUnit}
              onSave={onUpdateAnnotation}
            />
          )}

          <p className="annotations-hint">Clic derecho sobre un punto para eliminarlo.</p>
        </div>
      )}
    </div>
  );
}