import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import type { Annotation } from "../types";
import { describeRange, formatReading, isOutOfRange } from "../utils/annotations";
import { RangeEditor } from "./RangeEditor";
import "./annotations.css";
import "./PDFViewer.css";

interface PDFViewerProps {
  pdfPath: string;
  pdfName: string;
  annotations: Annotation[];
  onAddAnnotation: (annotation: Annotation) => void;
  onRemoveAnnotation: (id: string) => void;
  onUpdateAnnotation: (id: string, patch: Partial<Annotation>) => void;
  /** Punto seleccionado. Vive en `App` para poder atribuirle la lectura viva. */
  selectedId: string | null;
  onSelectAnnotation: (id: string | null) => void;
  liveReading?: number | null;
  liveUnit?: string;
  liveAnnotationId?: string | null;
}

// El worker de pdf.js debe servirse desde el bundle: copiarlo a `public/`
// requiere una paso de build que no está en el pipeline actual.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

const MIN_SCALE = 0.25;
const MAX_SCALE = 4;

/**
 * Lee el PDF del disco.
 *
 * El webview no puede hacer `fetch` a una ruta local, así que se lee con el
 * plugin de fs.
 */
async function fetchPdfData(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return await readFile(path);
}

export function PDFViewer({
  pdfPath,
  pdfName,
  annotations,
  onAddAnnotation,
  onRemoveAnnotation,
  onUpdateAnnotation,
  selectedId,
  onSelectAnnotation,
  liveReading,
  liveUnit,
  liveAnnotationId,
}: PDFViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Uint8Array | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // El prop `file` de react-pdf no acepta una promesa: hay que tener los bytes
  // en memoria antes de renderizar el `Document`.
  useEffect(() => {
    let cancelled = false;

    setData(null);
    setError(null);
    setPage(1);

    fetchPdfData(pdfPath)
      .then((bytes) => {
        if (!cancelled) setData(bytes);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });

    return () => {
      cancelled = true;
    };
  }, [pdfPath]);

  const pageAnnotations = useMemo(
    () => annotations.filter((a) => (a.page ?? 1) === page),
    [annotations, page]
  );

  // El punto abierto en el editor de rango. Puede quedar deseleccionado al
  // borrar el punto que se estaba editando.
  const selected = annotations.find((a) => a.id === selectedId) ?? null;

  /** Selecciona un punto y salta a la página donde está, si no es esta. */
  const focusAnnotation = useCallback(
    (annotation: Annotation) => {
      onSelectAnnotation(annotation.id);
      setPage(annotation.page ?? 1);
    },
    [onSelectAnnotation]
  );

  const clamp = (n: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, n));

  const goToPage = useCallback((n: number) => {
    setPage(Math.min(Math.max(1, n), numPages || 1));
  }, [numPages]);

  const handlePageClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isAnnotating) return;

      const label = window.prompt("Etiqueta del punto de prueba:");
      if (!label?.trim()) return;

      // El canvas de pdf.js ya viene escalado por `scale`, así que dividir por
      // la escala devuelve las coordenadas de la página sin el zoom aplicado.
      const rect = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      const id = crypto.randomUUID();

      onAddAnnotation({
        id,
        point: { x, y },
        page,
        label: label.trim(),
        color: "#ff6b6b",
        timestamp: new Date().toISOString(),
      });
      // Un punto recién marcado es el que el técnico está por medir: la lectura
      // viva pasa a atribuirse a él.
      onSelectAnnotation(id);
    },
    [isAnnotating, page, scale, onAddAnnotation, onSelectAnnotation]
  );

  return (
    <div className="pdf-viewer">
      <div className="viewer-toolbar">
        <button onClick={() => goToPage(page - 1)} disabled={page <= 1} aria-label="Página anterior">
          ‹
        </button>
        <span className="page-indicator">
          {numPages ? `${page} / ${numPages}` : "cargando…"}
        </span>
        <button
          onClick={() => goToPage(page + 1)}
          disabled={!numPages || page >= numPages}
          aria-label="Página siguiente"
        >
          ›
        </button>

        <span className="toolbar-separator" />

        <button onClick={() => setScale((s) => clamp(s / 1.2))} aria-label="Alejar">
          −
        </button>
        <span className="zoom-level">{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale((s) => clamp(s * 1.2))} aria-label="Acercar">
          +
        </button>

        <span className="toolbar-separator" />

        <button
          onClick={() => setIsAnnotating((v) => !v)}
          className={isAnnotating ? "active" : ""}
        >
          {isAnnotating ? "Cancelar" : "Anotar"}
        </button>
      </div>

      <div className="pdf-canvas" ref={containerRef}>
        {error ? (
          <div className="viewer-error">
            <h3>No se pudo abrir el PDF</h3>
            <p>{error}</p>
            <code>{pdfPath}</code>
          </div>
        ) : data === null ? (
          <div className="pdf-loading">Abriendo {pdfName}…</div>
        ) : (
          <Document
            file={{ data }}
            onLoadSuccess={({ numPages }) => setNumPages(numPages)}
            onLoadError={(e) => setError((e as Error).message)}
            loading={<div className="pdf-loading">Abriendo {pdfName}…</div>}
          >
            <div
              className="pdf-page-wrap"
              onClick={handlePageClick}
              style={{ cursor: isAnnotating ? "crosshair" : "default" }}
            >
              <Page
                pageNumber={page}
                scale={scale}
                // La capa de texto habilita buscar y copiar etiquetas del
                // esquemático, que es medio del flujo de trabajo del técnico.
                renderTextLayer
                renderAnnotationLayer={false}
              />

              {/*
                Los puntos se guardan en coordenadas de página sin zoom, pero
                el canvas de pdf.js ya viene escalado. En vez de multiplicar
                cada coordenada por `scale` —que obliga a rehacer el cálculo en
                cada zoom— el overlay entero se escala al revés: queda en
                unidades de página y CSS hace la transformación.
              */}
              <div
                className="pdf-annotations-overlay"
                style={{ transform: `scale(${1 / scale})` }}
              >
                {pageAnnotations.map((annotation) => {
                  const isLiveTarget = annotation.id === liveAnnotationId;
                  const value = isLiveTarget
                    ? liveReading
                    : annotation.lastReading?.value;
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
                      className={`annotation-point ${annotation.id === selectedId ? "selected" : ""} ${outOfRange ? "out-of-range" : ""} ${isLiveTarget ? "live" : ""}`}
                      style={{
                        left: annotation.point.x,
                        top: annotation.point.y,
                        borderColor: outOfRange ? "#ff4757" : annotation.color,
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAnnotation(annotation.id);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemoveAnnotation(annotation.id);
                      }}
                      title={`${annotation.label}${value != null ? `: ${formatReading(value)}${unit ?? ""}` : ""}`}
                    >
                      <span className="annotation-label">{annotation.label}</span>
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
          </Document>
        )}
      </div>

      {annotations.length > 0 && (
        <div className="annotations-panel">
          <h4>Puntos de prueba ({annotations.length})</h4>
          <ul>
            {annotations.map((a) => {
              const isOnPage = (a.page ?? 1) === page;
              const outOfRange =
                !a.lastReading?.is_overflow && isOutOfRange(a, a.lastReading?.value ?? NaN);

              return (
                <li key={a.id} className={a.id === selectedId ? "selected" : ""}>
                  <button
                    className="annotation-select"
                    onClick={() => focusAnnotation(a)}
                    title={isOnPage ? "Ir al punto" : `Está en la página ${a.page ?? 1}`}
                  >
                    {isOnPage ? "" : `p${a.page ?? 1} · `}
                    {a.label}
                  </button>
                  {describeRange(a) !== "" ? (
                    <span
                      className={`annotation-range ${outOfRange ? "out-of-range" : ""}`}
                      title={outOfRange ? "La última lectura se salió del rango" : undefined}
                    >
                      {describeRange(a)}
                    </span>
                  ) : (
                    <span className="annotation-range none" title="Sin rango esperado">
                      sin rango
                    </span>
                  )}
                  <button
                    onClick={() => onRemoveAnnotation(a.id)}
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

          <p className="annotations-hint">
            {pageAnnotations.length} en esta página. Clic derecho sobre un punto para eliminarlo.
          </p>
        </div>
      )}
    </div>
  );
}