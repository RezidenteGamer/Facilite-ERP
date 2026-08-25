import "./FormField.css";

type FormFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "date" | "email" | "password" | "select";
  /** Só para `type: "select"`. */
  options?: { value: string; label: string }[];
  disabled?: boolean;
  /** Texto curto abaixo do campo — só para explicar algo não óbvio pelo rótulo. */
  hint?: string;
};

/**
 * Campo de formulário do sistema: rótulo acima e cápsula branca abaixo.
 * Compartilhado pelo motor genérico (`RegistryFormModal`) e pelas telas de
 * venda, pedido, compra e devolução.
 *
 * Campos que consultam outro cadastro **não** moram aqui: eles usam o
 * `SearchCombobox` (digitação com sugestão), que reaproveita esta mesma
 * moldura via `FormField.css`.
 */
export default function FormField({
  id,
  label,
  value,
  onChange,
  type = "text",
  options,
  disabled = false,
  hint,
}: FormFieldProps) {
  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={id}>
        {label}
      </label>

      <div className={`form-field__control${disabled ? " form-field__control--disabled" : ""}`}>
        {type === "select" ? (
          <select
            id={id}
            className="form-field__input"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          >
            {options?.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            id={id}
            className="form-field__input"
            type={type}
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
            /* iOS Safari não redimensiona a viewport quando o teclado abre —
               sem isto, um campo perto do rodapé some atrás dele ao focar. */
            onFocus={(event) => event.target.scrollIntoView({ block: "center", behavior: "smooth" })}
          />
        )}
      </div>

      {hint && <p className="form-field__hint">{hint}</p>}
    </div>
  );
}
