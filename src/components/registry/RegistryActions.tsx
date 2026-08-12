import { SearchIcon } from "../icons";
import "./RegistryActions.css";

export type RegistryAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  /** Abre um espaço maior antes do botão — separa ações destrutivas das demais. */
  detached?: boolean;
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
  actions: RegistryAction[];
};

/** Coluna da esquerda dos módulos de cadastro: título + botões de ação. */
export default function RegistryActions({
  title,
  titleVariant = "default",
  search,
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

      {actions.map((action) => (
        <button
          key={action.id}
          className={`registry-actions__btn${action.detached ? " registry-actions__btn--detached" : ""}`}
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
