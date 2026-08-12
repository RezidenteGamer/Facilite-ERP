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
  /** Sem título o painel começa direto na busca/campos (ex.: Compras). */
  title?: string;
  /** "brand" usa a fonte cursiva do logo (ex.: painel "Controles"). */
  titleVariant?: "default" | "brand";
  search?: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    /** Mostra o rótulo acima do campo, em vez de só placeholder/aria-label. */
    showLabel?: boolean;
  };
  /** Subtítulo acima da lista de campos (ex.: "Vencimento" no Financeiro). */
  fieldsTitle?: string;
  /** Ficha resumida do item selecionado, sem caixa (ex.: Documento, Emissão). */
  fields?: RegistryActionField[];
  /** Subtítulo logo acima dos botões (ex.: "Opções para compras"). */
  actionsTitle?: string;
  actions: RegistryAction[];
};

/** Coluna da esquerda dos módulos de cadastro: título + botões de ação. */
export default function RegistryActions({
  title,
  titleVariant = "default",
  search,
  fieldsTitle,
  fields,
  actionsTitle,
  actions,
}: RegistryActionsProps) {
  return (
    <aside className="registry-actions">
      {title && (
        <p
          className={`registry-actions__title${
            titleVariant === "brand" ? " registry-actions__title--brand" : ""
          }`}
        >
          {title}
        </p>
      )}

      {search && (
        <div className="registry-actions__search-group">
          {search.showLabel && (
            <label className="registry-actions__search-label" htmlFor="registry-actions-search">
              {search.label}
            </label>
          )}
          <label className="registry-actions__search">
            <span className="registry-actions__search-icon">
              <SearchIcon />
            </span>
            <input
              id="registry-actions-search"
              type="search"
              aria-label={search.label}
              placeholder={search.showLabel ? undefined : search.label}
              value={search.value}
              onChange={(event) => search.onChange(event.target.value)}
            />
          </label>
        </div>
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

      {actionsTitle && <p className="registry-actions__actions-title">{actionsTitle}</p>}

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
