import { useEffect, useState } from "react";
import { SearchIcon } from "../icons";
import "./RegistryActions.css";

export type RegistryAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  /** Abre um espaço maior antes do botão — separa ações destrutivas das demais. */
  detached?: boolean;
  /** "danger" pinta o botão de vermelho (ex.: "Cancelar", "Excluir definitivo").
   *  "positive" pinta de verde claro (ex.: "Novo produto", "Nova compra"). */
  tone?: "default" | "danger" | "positive";
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

/**
 * Coluna da esquerda dos módulos de cadastro: título + botões de ação.
 *
 * Em mobile este painel inteiro (busca + campos + botões) vira uma folha
 * que sobe de baixo, atrás de um botão gatilho — do jeito que estava,
 * empilhado, ele empurraria a tabela (o conteúdo mais importante) para
 * bem longe do topo. O mesmo conteúdo é usado nos dois casos; só a
 * moldura muda (ver RegistryActions.css).
 */
export default function RegistryActions({
  title,
  titleVariant = "default",
  search,
  fieldsTitle,
  fields,
  actionsTitle,
  actions,
}: RegistryActionsProps) {
  const [sheetOpen, setSheetOpen] = useState(false);

  useEffect(() => {
    if (!sheetOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSheetOpen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [sheetOpen]);

  const body = (
    <>
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
          }${action.tone === "positive" ? " registry-actions__btn--positive" : ""}`}
          type="button"
          data-action={action.id}
          disabled={action.disabled}
          onClick={() => {
            action.onClick?.();
            setSheetOpen(false);
          }}
        >
          {action.label}
        </button>
      ))}
    </>
  );

  return (
    <>
      <aside className="registry-actions registry-actions--panel">{body}</aside>

      <div className="registry-actions--trigger-slot">
        <button
          type="button"
          className="registry-actions__trigger"
          onClick={() => setSheetOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={sheetOpen}
        >
          {title ?? actionsTitle ?? "Ações"}
        </button>
      </div>

      {sheetOpen && (
        <div className="registry-actions__sheet-overlay" onClick={() => setSheetOpen(false)}>
          <aside
            className="registry-actions registry-actions--sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title ?? actionsTitle ?? "Ações"}
            onClick={(event) => event.stopPropagation()}
          >
            <span className="registry-actions__sheet-handle" aria-hidden="true" />
            <button
              type="button"
              className="registry-actions__sheet-close"
              aria-label="Fechar"
              onClick={() => setSheetOpen(false)}
            >
              ×
            </button>
            {body}
          </aside>
        </div>
      )}
    </>
  );
}
