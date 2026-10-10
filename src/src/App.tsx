import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import "./App.css";
import { pickSchematic, shutdownDevices } from "./utils/tauri";
import { useSchematics } from "./hooks/useSchematics";
import { useAnnotations } from "./hooks/useAnnotations";
import { useLiveMeasurement } from "./hooks/useLiveMeasurement";
import { useMeasurements } from "./hooks/useMeasurements";
import { useCases } from "./hooks/useCases";
import { ImageViewer } from "./components/ImageViewer";

// pdf.js pesa ~540 kB minificados. Cargarlo bajo demanda deja el bundle inicial
// en un tamaño razonable para los técnicos que solo miran imágenes.
const PDFViewer = lazy(() =>
  import("./components/PDFViewer").then((m) => ({ default: m.PDFViewer }))
);
import { MeasurementPanel } from "./components/MeasurementPanel";
import { CasePanel } from "./components/CasePanel";
import type { Schematic } from "./types";

type View = "home" | "viewer";

function App() {
  const [view, setView] = useState<View>("home");
  const [current, setCurrent] = useState<Schematic | null>(null);
  const [loading, setLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const { schematics, addSchematic, removeSchematic } = useSchematics();

  // Las anotaciones son por esquemático: al cambiar de vista se recargan.
  const {
    annotations,
    addAnnotation,
    updateAnnotation,
    removeAnnotation,
  } = useAnnotations(current?.id);

  // El estado de las mediciones vive acá y no en el panel: los casos archivan
  // el historial, y un caso pertenece al esquemático, no al panel.
  const measurements = useMeasurements({ active: panelOpen });

  const {
    createCase,
    updateCase,
    removeCase,
    addMeasurements,
    getCasesForSchematic,
  } = useCases();

  const schematicCases = useMemo(
    () => (current ? getCasesForSchematic(current.id) : []),
    [current, getCasesForSchematic]
  );

  /**
   * Punto al que se le atribuye la lectura viva.
   *
   * Sin esto el multímetro pinta su valor sobre todos los puntos a la vez. El
   * técnico elige en qué está midiendo: el punto que acaba de marcar, o el que
   * tiene seleccionado.
   */
  const [activePointId, setActivePointId] = useState<string | null>(null);

  /** Punto seleccionado en el esquema, para abrirle el editor de rango. */
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);

  /**
   * La lectura viva se atribuye a `activePointId`, que se fija al seleccionar
   * un punto, y no directamente al seleccionado: el técnico marca el punto y
   * después mueve la vista o el zoom, y el binding no debe saltar por eso.
   */
  const handleSelectPoint = useCallback((id: string | null) => {
    setSelectedPointId(id);
    if (id) setActivePointId(id);
  }, []);

  // Al cambiar de esquemático las referencias dejan de existir: si no se
  // limpian, el punto seleccionado apunta a un id que ya no está en el store.
  useEffect(() => {
    setSelectedPointId(null);
    setActivePointId(null);
  }, [current?.id]);

  // Si borran el punto que tenía la lectura viva, el binding queda colgando de
  // un id inexistente y el valor deja de mostrarse sin avisar.
  useEffect(() => {
    if (activePointId && !annotations.some((a) => a.id === activePointId)) {
      setActivePointId(null);
    }
    if (selectedPointId && !annotations.some((a) => a.id === selectedPointId)) {
      setSelectedPointId(null);
    }
  }, [annotations, activePointId, selectedPointId]);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setNotice(null);

    try {
      const schematic = await pickSchematic();
      if (!schematic) return;

      addSchematic(schematic);
      setCurrent(schematic);
      setView("viewer");
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [addSchematic]);

  const handleBack = useCallback(() => {
    setView("home");
    setCurrent(null);
  }, []);

  const handleOpen = useCallback((schematic: Schematic) => {
    setCurrent(schematic);
    setView("viewer");
  }, []);

  const handleDelete = useCallback(
    (schematic: Schematic) => {
      if (!window.confirm(`¿Quitar "${schematic.name}" del historial?`)) return;
      removeSchematic(schematic.id);
      setNotice("Esquemático quitado del historial.");
    },
    [removeSchematic]
  );

  /**
   * Cierra los puertos COM al salir. `beforeunload` no alcanza porque la app
   * puede cerrarse desde el menú de la ventana.
   */
  const handleClose = useCallback(async () => {
    try {
      await shutdownDevices();
    } catch {
      // Si falla, el backend limpia igual en `close-requested`.
    }
    window.close();
  }, []);

  // Lectura viva para superponerla sobre los puntos marcados del esquemático.
  const live = useLiveMeasurement(panelOpen);

  // En overflow no hay número que comparar contra el rango: se oculta el valor
  // para que el punto no se marque fuera de rango por un `OL` mal leído.
  const liveValue = live && !live.is_overflow ? live.value : null;

  /** Archiva el historial del panel en un caso, y avisa si no había nada. */
  const handleArchive = useCallback(
    (caseId: string, toArchive: typeof measurements.history) => {
      if (toArchive.length === 0) {
        setNotice("No hay mediciones en el panel para archivar.");
        return;
      }
      addMeasurements(caseId, toArchive);
      setNotice(`${toArchive.length} mediciones archivadas.`);
    },
    [addMeasurements]
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="brand">
          <h1>VolFix</h1>
          <p>Diagnóstico en tiempo real para reparación móvil</p>
        </div>
        {view === "home" && (
          <button className="btn-ghost" onClick={handleClose} title="Salir">
            Salir
          </button>
        )}
      </header>

      {notice && (
        <div className="app-notice" onClick={() => setNotice(null)} role="status">
          {notice}
        </div>
      )}

      <main className="app-main">
        {view === "home" ? (
          <div className="home-view">
            <div className="welcome-card">
              <h2>Bienvenido a VolFix</h2>
              <p>Cargá tu esquemático para comenzar el diagnóstico</p>
              <button className="btn-primary" onClick={handleLoad} disabled={loading}>
                {loading ? "Abriendo…" : "Cargar esquemático"}
              </button>
              <p className="welcome-hint">
                Se aceptan PDF e imágenes (PNG, JPG, BMP, WEBP).
              </p>
            </div>

            <div className="recent-cases">
              <h3>Esquemáticos recientes</h3>

              {schematics.length === 0 ? (
                <p className="placeholder">
                  No hay esquemáticos cargados aún.
                </p>
              ) : (
                <ul className="schematic-list">
                  {schematics.map((schematic) => (
                    <li key={schematic.id} className="schematic-item">
                      <button
                        className="schematic-open"
                        onClick={() => handleOpen(schematic)}
                      >
                        <span className="schematic-icon">
                          {schematic.fileType === "pdf" ? "📄" : "🖼️"}
                        </span>
                        <span className="schematic-info">
                          <strong>{schematic.name}</strong>
                          <small>{formatDate(schematic.uploadedAt)}</small>
                        </span>
                      </button>
                      <button
                        className="schematic-remove"
                        onClick={() => handleDelete(schematic)}
                        aria-label={`Quitar ${schematic.name} del historial`}
                        title="Quitar del historial"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : (
          <div className="viewer-view">
            <div className="viewer-header">
              <button className="btn-back" onClick={handleBack}>
                ← Volver
              </button>
              <h3>{current?.name ?? "Sin nombre"}</h3>
              <div className="viewer-actions">
                {current && (
                  <span className="schematic-path" title={current.filePath}>
                    {current.fileType.toUpperCase()}
                  </span>
                )}
                <button
                  className="btn-measurements"
                  onClick={() => setPanelOpen((v) => !v)}
                >
                  📊 Mediciones
                </button>
              </div>
            </div>

            <div className="viewer-content">
              {!current ? (
                <p className="placeholder">Ningún esquemático abierto.</p>
              ) : current.fileType === "image" ? (
                <ImageViewer
                  imagePath={current.filePath}
                  imageName={current.name}
                  annotations={annotations}
                  onAddAnnotation={addAnnotation}
                  onRemoveAnnotation={removeAnnotation}
                  onUpdateAnnotation={updateAnnotation}
                  selectedId={selectedPointId}
                  onSelectAnnotation={handleSelectPoint}
                  liveReading={liveValue}
                  liveUnit={live?.unit}
                  liveAnnotationId={activePointId}
                />
              ) : (
                <Suspense
                  fallback={<p className="placeholder">Cargando el visor de PDF…</p>}
                >
                  <PDFViewer
                    pdfPath={current.filePath}
                    pdfName={current.name}
                    annotations={annotations}
                    onAddAnnotation={addAnnotation}
                    onRemoveAnnotation={removeAnnotation}
                    onUpdateAnnotation={updateAnnotation}
                    selectedId={selectedPointId}
                    onSelectAnnotation={handleSelectPoint}
                    liveReading={liveValue}
                    liveUnit={live?.unit}
                    liveAnnotationId={activePointId}
                  />
                </Suspense>
              )}
            </div>

            {current && (
              <CasePanel
                schematicId={current.id}
                cases={schematicCases}
                onCreate={createCase}
                onUpdate={updateCase}
                onRemove={removeCase}
                onArchiveMeasurements={handleArchive}
                availableMeasurements={measurements.history}
                defaultModel={current.deviceModel ?? current.name}
              />
            )}
          </div>
        )}
      </main>

      <MeasurementPanel
        isOpen={panelOpen}
        onClose={() => setPanelOpen(false)}
        measurements={measurements}
      />
    </div>
  );
}

/** Formatea una fecha ISO para la lista de recientes. */
function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export default App;