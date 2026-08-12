import { SearchIcon } from "../icons";
import "./RegistryActions.css";

export type RegistryAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  /** Abre um espaço maior antes do botão — separa ações destrutivas das demais. */
  detached?: boolean;
  /** "danger" pinta o botão de vermelho (ex.: "Cancelar", "Excluir definitivo"). */
  tone?: "default" | "danger";
};

export type RegistryActionField = {
  label: string;
  value?: string;
};

type RegistryActionsProps = {
  title: string;
  /** "brand" usa a fonte cursiva do logo (ex.: painel "Controles"). */
  titleVariant?: "default" | "brand";
  search?: {
    label: string;
    value: string;
    onChange: (value: string) => void;
  };
  /** Subtítulo acima da lista de campos (ex.: "Vencimento" no Financeiro). */
  fieldsTitle?: string;
  /** Ficha resumida do item selecionado, sem caixa (ex.: Documento, Emissão). */
  fields?: RegistryActionField[];
  actions: RegistryAction[];
};

/** Coluna da esquerda dos módulos de cadastro: título + botões de ação. */
export default function RegistryActions({
  title,
  titleVariant = "default",
  search,
  fieldsTitle,
  fields,
  actions,
}: RegistryActionsProps) {
  return (
    <aside className="registry-actions">
      <p
        className={`registry-actions__title${
          titleVariant === "brand" ? " registry-actions__title--brand" : ""
        }`}
      >
        {title}
      </p>

      {search && (
        <label className="registry-actions__search">
          <span className="registry-actions__search-icon">
            <SearchIcon />
          </span>
          <input
            type="search"
            aria-label={search.label}
            placeholder={search.label}
            value={search.value}
            onChange={(event) => search.onChange(event.target.value)}
          />
        </label>
      )}

      {(fieldsTitle || fields) && (
        <dl className="registry-actions__fields">
          {fieldsTitle && <p className="registry-actions__fields-title">{fieldsTitle}</p>}
          {fields?.map((field) => (
            <div className="registry-actions__field" key={field.label}>
              <dt>{field.label}:</dt>
              <dd>{field.value ?? ""}</dd>
            </div>
          ))}
        </dl>
      )}

      {actions.map((action) => (
        <button
          key={action.id}
          className={`registry-actions__btn${action.detached ? " registry-actions__btn--detached" : ""}${
            action.tone === "danger" ? " registry-actions__btn--danger" : ""
          }`}
          type="button"
          data-action={action.id}
          disabled={action.disabled}
          onClick={action.onClick}
        >
          {action.label}
        </button>
      ))}
    </aside>
  );
}
