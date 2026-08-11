import { SearchIcon } from "../icons";
import "./RegistryDetails.css";

export type RegistryField = {
  label: string;
  value?: string;
};

export type RegistryMedia = {
  label: string;
  /** Texto sobre a imagem (ex.: "Ou arraste para cá"). */
  hint?: string;
  /** "stacked": rótulo acima e imagem centralizada. "inline": lado a lado. */
  layout?: "stacked" | "inline";
};

type RegistryDetailsProps = {
  searchLabel: string;
  search: string;
  onSearchChange: (value: string) => void;
  status?: {
    active: boolean;
    disabled?: boolean;
    onToggle: () => void;
  };
  fields: RegistryField[];
  media?: RegistryMedia;
};

/** Coluna da direita dos módulos de cadastro: busca, situação e ficha. */
export default function RegistryDetails({
  searchLabel,
  search,
  onSearchChange,
  status,
  fields,
  media,
}: RegistryDetailsProps) {
  const mediaLayout = media?.layout ?? "stacked";

  const figura = media ? (
    <div className="registry-details__media-frame">
      <svg viewBox="0 0 64 52" fill="none" aria-hidden="true">
        <rect x="12" y="4" width="46" height="34" rx="2" stroke="currentColor" strokeWidth="2.5" />
        <rect
          x="4"
          y="12"
          width="46"
          height="34"
          rx="2"
          fill="var(--blue-panel-edge)"
          stroke="currentColor"
          strokeWidth="2.5"
        />
        <circle cx="38" cy="22" r="4" stroke="currentColor" strokeWidth="2.5" />
        <path d="M6 40l12-11 9 8 7-6 15 13" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" />
      </svg>
      {media.hint && <span className="registry-details__media-hint">{media.hint}</span>}
    </div>
  ) : null;

  return (
    <aside className="registry-details">
      <label className="registry-details__search-label" htmlFor="registry-search">
        {searchLabel}
      </label>
      <div className="registry-details__search">
        <span className="registry-details__search-icon">
          <SearchIcon />
        </span>
        <input
          id="registry-search"
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
        />
      </div>

      <div className="registry-details__card">
        {status && (
          <>
            <p className="registry-details__status-title">Situação</p>
            <div className="registry-details__status">
              <span className="registry-details__status-side">Ativo</span>
              <button
                className={`registry-details__switch${status.active ? " registry-details__switch--on" : ""}`}
                type="button"
                role="switch"
                aria-checked={status.active}
                aria-label="Situação do cadastro"
                disabled={status.disabled}
                onClick={status.onToggle}
              >
                <span className="registry-details__switch-knob" />
              </button>
              <span className="registry-details__status-side">Inativo</span>
            </div>
          </>
        )}

        <dl className="registry-details__fields">
          {fields.map((field) => (
            <div className="registry-details__field" key={field.label}>
              <dt>{field.label}:</dt>
              <dd>{field.value ?? ""}</dd>
            </div>
          ))}
        </dl>

        {media && mediaLayout === "stacked" && (
          <>
            <p className="registry-details__media-label">{media.label}:</p>
            <div className="registry-details__media registry-details__media--stacked">{figura}</div>
          </>
        )}

        {media && mediaLayout === "inline" && (
          <div className="registry-details__media registry-details__media--inline">
            <p className="registry-details__media-label">{media.label}:</p>
            {figura}
          </div>
        )}
      </div>
    </aside>
  );
}
