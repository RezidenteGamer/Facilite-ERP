import type { ModuleFieldDefinition } from "../registry-engine/types";
import FieldTypeIcon from "./FieldTypeIcon";
import { FIELD_TYPES } from "./moduleBuilder";
import "./ModuleBuilderPage.css";

type FieldTypePickerProps = {
  value: ModuleFieldDefinition["dataType"];
  onChange: (next: ModuleFieldDefinition["dataType"]) => void;
  disabled?: boolean;
  /** `small` é o tamanho que cabe dentro do cartão do canvas. */
  size?: "small" | "normal";
};

/**
 * Os cinco tipos lado a lado, cada um um botão com o próprio ícone — no lugar
 * do `<select>` que existia até aqui.
 *
 * Continua sendo **só** os `data_type` que o motor já conhece; a mudança é de
 * superfície, não de capacidade. O nome do tipo continua legível (`title` +
 * `aria-label`, e o rótulo escrito embaixo no tamanho normal): esconder o
 * nome atrás de um desenho trocaria um problema (formulário burocrático) por
 * outro (adivinhação).
 */
export default function FieldTypePicker({
  value,
  onChange,
  disabled = false,
  size = "normal",
}: FieldTypePickerProps) {
  return (
    <div
      className={`module-builder__type-picker${
        size === "small" ? " module-builder__type-picker--small" : ""
      }`}
      role="radiogroup"
      aria-label="Tipo do campo"
    >
      {FIELD_TYPES.map((type) => (
        <button
          key={type.value}
          type="button"
          role="radio"
          aria-checked={type.value === value}
          aria-label={type.label}
          title={type.label}
          disabled={disabled}
          className={`module-builder__type-option${
            type.value === value ? " module-builder__type-option--on" : ""
          }`}
          onClick={() => onChange(type.value)}
        >
          <FieldTypeIcon dataType={type.value} className="module-builder__type-glyph" />
          {size === "normal" && (
            <span className="module-builder__type-name">{type.label}</span>
          )}
        </button>
      ))}
    </div>
  );
}
