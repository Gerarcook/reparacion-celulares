import { useEffect, useState } from "react";
import type { Annotation } from "../types";
import { describeRange, parseRangeBound } from "../utils/annotations";
import "./RangeEditor.css";

interface RangeEditorProps {
  annotation: Annotation;
  /** Último valor medido, para proponer un rango a partir de lo que se leyó. */
  liveReading?: number | null;
  liveUnit?: string;
  onSave: (id: string, patch: Partial<Annotation>) => void;
}

/**
 * Formulario de rango esperado para un punto de prueba.
 *
 * Es la pieza que cierra el ciclo: el tipo `Annotation.expected` ya existía y
 * los visores ya lo leían, pero ningún código lo escribía. Un rango sin valor
 * por defecto no hace nada — hay que declararlo a mano, y declararlo es
 * justamente lo que el técnico no quiere hacer mientras mide.
 */

/** Campos editables; el estado se resincroniza al cambiar de punto. */
interface Draft {
  min: string;
  max: string;
  unit: string;
}

function toDraft(annotation: Annotation): Draft {
  const { min, max, unit } = annotation.expected ?? {};
  return {
    min: min == null ? "" : String(min),
    max: max == null ? "" : String(max),
    unit: unit ?? "",
  };
}

export function RangeEditor({
  annotation,
  liveReading,
  liveUnit,
  onSave,
}: RangeEditorProps) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(annotation));
  const [dirty, setDirty] = useState(false);

  // Al seleccionar otro punto el formulario tiene que mostrar los valores de
  // ese punto, no los que el técnico dejó a medias en el anterior.
  useEffect(() => {
    setDraft(toDraft(annotation));
    setDirty(false);
  }, [annotation]);

  const min = parseRangeBound(draft.min);
  const max = parseRangeBound(draft.max);
  const unit = draft.unit.trim();

  // Un rango invertido siempre marca el punto como fuera de rango, porque
  // cualquier valor cumple `>= min` y `<= max` a la vez o ninguna. Se avisa en
  // vez de guardar algo que va a dar falsos positivos.
  const inverted = min != null && max != null && min > max;

  // Texto que no se pudo interpretar como número. Se valida en el input para no
  // perder lo que el técnico está escribiendo.
  const minInvalid = draft.min.trim() !== "" && min == null;
  const maxInvalid = draft.max.trim() !== "" && max == null;

  const canSave =
    (min != null || max != null || unit !== "") &&
    !inverted &&
    !minInvalid &&
    !maxInvalid &&
    dirty;

  const handleSave = () => {
    if (min == null && max == null && unit === "") {
      // Sin rango: se borra el campo entero para no dejar un `expected` vacío
      // que `describeRange` muestre como unidad suelta.
      const { expected: _expected, lastReading: _reading, ...rest } = annotation;
      onSave(annotation.id, rest as Partial<Annotation>);
      setDirty(false);
      return;
    }

    onSave(annotation.id, {
      expected: {
        ...(min != null ? { min } : {}),
        ...(max != null ? { max } : {}),
        ...(unit !== "" ? { unit } : {}),
      },
    });
    setDirty(false);
  };

  /** Propone el rango de la lectura actual, con un margen del 5%. */
  const handleUseReading = () => {
    if (liveReading == null || !Number.isFinite(liveReading)) return;

    const margin = Math.abs(liveReading) * 0.05;
    setDraft({
      min: String(Number((liveReading - margin).toFixed(4))),
      max: String(Number((liveReading + margin).toFixed(4))),
      unit: unit || liveUnit || "",
    });
    setDirty(true);
  };

  return (
    <div className="range-editor">
      <div className="range-editor-header">
        <h4>Rango esperado · {annotation.label}</h4>
        <span className="range-editor-current">
          {describeRange(annotation) || "sin rango"}
        </span>
      </div>

      <div className="range-editor-fields">
        <label>
          <span>Mín</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={draft.min}
            placeholder="—"
            className={minInvalid ? "invalid" : ""}
            onChange={(e) => {
              setDraft((d) => ({ ...d, min: e.target.value }));
              setDirty(true);
            }}
          />
        </label>

        <label>
          <span>Máx</span>
          <input
            type="number"
            step="any"
            inputMode="decimal"
            value={draft.max}
            placeholder="—"
            className={maxInvalid ? "invalid" : ""}
            onChange={(e) => {
              setDraft((d) => ({ ...d, max: e.target.value }));
              setDirty(true);
            }}
          />
        </label>

        <label>
          <span>Unidad</span>
          <input
            type="text"
            value={draft.unit}
            placeholder="V"
            onChange={(e) => {
              setDraft((d) => ({ ...d, unit: e.target.value }));
              setDirty(true);
            }}
          />
        </label>
      </div>

      {minInvalid && <p className="range-editor-error">El mínimo no es un número.</p>}
      {maxInvalid && <p className="range-editor-error">El máximo no es un número.</p>}
      {inverted && (
        <p className="range-editor-error">
          El mínimo es mayor que el máximo. Ninguna lectura cumpliría este rango.
        </p>
      )}

      <div className="range-editor-actions">
        {liveReading != null && Number.isFinite(liveReading) && (
          <button
            className="btn-small"
            onClick={handleUseReading}
            title="Usar la lectura actual ±5% como rango"
          >
            ⚡ Usar lectura
          </button>
        )}
        <button className="btn-small btn-primary" onClick={handleSave} disabled={!canSave}>
          Guardar
        </button>
        <button
          className="btn-small"
          onClick={() => {
            setDraft({ min: "", max: "", unit: "" });
            setDirty(true);
          }}
        >
          Limpiar
        </button>
      </div>
    </div>
  );
}