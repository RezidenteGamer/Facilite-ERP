import type { ReactNode } from "react";
import "./RegistryTable.css";

export type RegistryColumn<T> = {
  key: string;
  label: string;
  /** Largura na grade CSS (ex.: "110px", "minmax(0, 1fr)"). */
  width: string;
  align?: "left" | "center" | "right";
  render: (row: T) => ReactNode;
};

export type RegistryTab = {
  id: string;
  label: string;
};

type RegistryTableProps<T> = {
  columns: RegistryColumn<T>[];
  rows: T[];
  getRowId: (row: T) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Sem abas o painel fecha os quatro cantos (caso de Produtos). */
  tabs?: RegistryTab[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
  /** Quantas linhas o quadro mostra mesmo com poucos cadastros. */
  minRows?: number;
};

/** Tabela dos módulos de cadastro: abas opcionais + linhas selecionáveis. */
export default function RegistryTable<T>({
  columns,
  rows,
  getRowId,
  selectedId,
  onSelect,
  tabs,
  activeTab,
  onTabChange,
  minRows = 7,
}: RegistryTableProps<T>) {
  const gridTemplate = columns.map((column) => column.width).join(" ");
  const placeholders = Math.max(0, minRows - rows.length);

  return (
    <section className="registry-table">
      {tabs && tabs.length > 0 && (
        <div className="registry-table__tabs" role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`registry-table__tab${activeTab === tab.id ? " registry-table__tab--active" : ""}`}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => onTabChange?.(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      <div className={`registry-table__panel${tabs?.length ? "" : " registry-table__panel--solo"}`}>
        <div className="registry-table__header" style={{ gridTemplateColumns: gridTemplate }}>
          {columns.map((column) => (
            <span key={column.key} style={{ textAlign: column.align ?? "left" }}>
              {column.label}
            </span>
          ))}
        </div>

        <div className="registry-table__rows">
          {rows.map((row) => {
            const id = getRowId(row);
            return (
              <button
                key={id}
                className={`registry-table__row${selectedId === id ? " registry-table__row--selected" : ""}`}
                style={{ gridTemplateColumns: gridTemplate }}
                type="button"
                onClick={() => onSelect(id)}
              >
                {columns.map((column) => (
                  <span key={column.key} style={{ textAlign: column.align ?? "left" }}>
                    {column.render(row)}
                  </span>
                ))}
              </button>
            );
          })}

          {Array.from({ length: placeholders }, (_, index) => (
            <div
              className="registry-table__row registry-table__row--empty"
              style={{ gridTemplateColumns: gridTemplate }}
              key={`vazio-${index}`}
              aria-hidden="true"
            >
              {columns.map((column) => (
                <span key={column.key} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
