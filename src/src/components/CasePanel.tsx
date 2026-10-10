import { useCallback, useState } from "react";
import type { Case, Measurement } from "../types";
import "./CasePanel.css";

interface CasePanelProps {
  /** Esquemático al que pertenecen los casos de esta vista. */
  schematicId: string;
  cases: Case[];
  onCreate: (input: Omit<Case, "id" | "createdAt" | "updatedAt">) => void;
  onUpdate: (id: string, patch: Partial<Case>) => void;
  onRemove: (id: string) => void;
  onArchiveMeasurements: (caseId: string, measurements: Measurement[]) => void;
  /** Medidas disponibles para archivar, del panel de mediciones. */
  availableMeasurements: Measurement[];
  defaultModel: string;
}

const STATUS_LABELS: Record<Case["status"], string> = {
  open: "Abierto",
  "in-progress": "En curso",
  resolved: "Resuelto",
};

/**
 * Casos del esquemático abierto.
 *
 * Archiva las mediciones que el técnico quiere conservar, no el flujo entero del
 * multímetro: guardar cada lectura llenaría el almacenamiento en minutos.
 */
export function CasePanel({
  schematicId,
  cases,
  onCreate,
  onUpdate,
  onRemove,
  onArchiveMeasurements,
  availableMeasurements,
  defaultModel,
}: CasePanelProps) {
  const [isCreating, setIsCreating] = useState(false);
  const [deviceModel, setDeviceModel] = useState(defaultModel);
  const [issue, setIssue] = useState("");

  const handleCreate = useCallback(() => {
    onCreate({
      schematicId,
      deviceModel: deviceModel.trim() || "Sin modelo",
      issue: issue.trim() || "Sin descripción",
      status: "open",
    });
    setIssue("");
    setIsCreating(false);
  }, [deviceModel, issue, onCreate, schematicId]);

  return (
    <div className="case-panel">
      <div className="case-panel-header">
        <h4>Casos ({cases.length})</h4>
        <button className="btn-small" onClick={() => setIsCreating((v) => !v)}>
          {isCreating ? "Cancelar" : "+ Nuevo caso"}
        </button>
      </div>

      {isCreating && (
        <div className="case-create">
          <input
            type="text"
            value={deviceModel}
            placeholder="Modelo del equipo"
            onChange={(e) => setDeviceModel(e.target.value)}
            aria-label="Modelo del equipo"
          />
          <input
            type="text"
            value={issue}
            placeholder="Falla reportada"
            onChange={(e) => setIssue(e.target.value)}
            aria-label="Falla reportada"
          />
          <button className="btn-small btn-primary" onClick={handleCreate}>
            Crear
          </button>
        </div>
      )}

      {cases.length === 0 ? (
        <p className="case-empty">
          Sin casos. Abrí uno para archivar las mediciones de este equipo.
        </p>
      ) : (
        <ul className="case-list">
          {cases.map((c) => (
            <li key={c.id} className={`case-item status-${c.status}`}>
              <div className="case-item-main">
                <strong>{c.deviceModel}</strong>
                <span className="case-issue">{c.issue}</span>
                <small>
                  {formatDate(c.createdAt)} · {c.measurements?.length ?? 0} mediciones
                </small>
              </div>

              <select
                value={c.status}
                onChange={(e) => onUpdate(c.id, { status: e.target.value as Case["status"] })}
                aria-label={`Estado de ${c.deviceModel}`}
              >
                {(Object.keys(STATUS_LABELS) as Case["status"][]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>

              {availableMeasurements.length > 0 && c.status !== "resolved" && (
                <button
                  className="btn-small"
                  onClick={() => onArchiveMeasurements(c.id, availableMeasurements)}
                  title="Archivar las mediciones del panel en este caso"
                >
                  📥 Archivar
                </button>
              )}

              <button
                className="btn-small"
                onClick={() => {
                  if (window.confirm(`¿Borrar el caso de ${c.deviceModel}?`)) {
                    onRemove(c.id);
                  }
                }}
                aria-label={`Borrar caso de ${c.deviceModel}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" });
}