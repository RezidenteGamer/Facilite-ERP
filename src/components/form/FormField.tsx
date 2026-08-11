import { SearchIcon } from "../icons";
import "./FormField.css";

type FormFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date";
  /** Mostra a lupa de consulta à direita (campos que abrem uma busca). */
  lookup?: boolean;
  onLookup?: () => void;
  disabled?: boolean;
};

/**
 * Campo de formulário do sistema: rótulo acima e cápsula branca abaixo,
 * com lupa opcional para os campos que consultam outro cadastro.
 * Compartilhado pelas telas de venda, pedido, compra e devolução.
 */
export default function FormField({
  id,
  label,
  value,
  onChange,
  type = "text",
  lookup = false,
  onLookup,
  disabled = false,
}: FormFieldProps) {
  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={id}>
        {label}
      </label>

      <div className={`form-field__control${disabled ? " form-field__control--disabled" : ""}`}>
        <input
          id={id}
          className="form-field__input"
          type={type}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />

        {lookup && (
          <button
            className="form-field__lookup"
            type="button"
            aria-label={`Consultar ${label}`}
            disabled={disabled}
            onClick={onLookup}
          >
            <SearchIcon />
          </button>
        )}
      </div>
    </div>
  );
}
