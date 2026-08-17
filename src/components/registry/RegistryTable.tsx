import type { ReactNode } from "react";
import "./RegistryTable.css";

export type RegistryColumn<T> = {
  key: string;
  label: string;
  /** Largura na grade CSS (ex.: "110px", "minmax(0, 1fr)"). */
  width: string;
  align?: "left" | "center" | "right";
  render: (row: T) => ReactNode;
  /**
   * Em mobile a tabela vira uma lista de cards e esta coluna vira o
   * título do card. Sem marcação explícita, cai na coluna
   * "minmax(0, 1fr)" quando existir só uma — que na prática é sempre
   * o nome/cliente/descrição em todos os módulos, exceto quando o
   * módulo já marca a coluna certa aqui.
   */
  primary?: boolean;
};

export type RegistryTab = {
  id: string;
  label: string;
};

export type RegistryTableAction = {
  id: string;
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  /** "danger" pinta o botão de vermelho (ex.: "Excluir definitivo"). */
  tone?: "default" | "danger";
};

/**
 * Um número-resumo acima da lista (ex.: "Total em aberto", "Entrou"/"Saiu"
 * no Financeiro). Genérico de propósito — o componente não sabe o que é "a
 * pagar" ou "saldo", só recebe rótulo/valor/tom já prontos. Vendas, Compras
 * e Controle de Caixa devem reaproveitar o mesmo slot quando chegar a vez.
 */
export type RegistrySummaryItem = {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
};

type RegistryTableProps<T> = {
  /** Título acima do quadro (ex.: "Pedidos de venda"). */
  title?: string;
  /** "brand" (padrão): fonte cursiva do logo. "plain": texto normal, à esquerda. */
  titleVariant?: "brand" | "plain";
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
  /** Botões centralizados no rodapé do próprio painel (ex.: Tributações). */
  footerActions?: RegistryTableAction[];
  /** Números-resumo acima da lista (ex.: totais do Financeiro). Sem isso, nada aparece. */
  summary?: RegistrySummaryItem[];
};

/** Largura mínima assumida para uma coluna flexível (ex.: "minmax(0, 1fr)")
    ao calcular quanto a tabela precisa de largura antes de rolar na
    horizontal — abaixo disso o texto da coluna principal fica ilegível. */
const FLEX_COLUMN_MIN_WIDTH = 170;

function columnMinWidth(width: string): number {
  const px = /^(\d+(?:\.\d+)?)px$/.exec(width.trim());
  return px ? parseFloat(px[1]) : FLEX_COLUMN_MIN_WIDTH;
}

function pickPrimaryColumn<T>(columns: RegistryColumn<T>[]): RegistryColumn<T> {
  const marked = columns.find((column) => column.primary);
  if (marked) return marked;

  const flexColumns = columns.filter((column) => column.width.includes("1fr"));
  if (flexColumns.length === 1) return flexColumns[0];

  return columns[0];
}

/** Tabela dos módulos de cadastro: abas opcionais + linhas selecionáveis.
    Em mobile (ver RegistryTable.css) a grade dá lugar a uma lista de
    cards empilhados — telas de campo não comportam 4-7 colunas lado a
    lado, e nenhum destes módulos precisa comparar colunas entre si, só
    identificar o registro (código + nome/cliente) e ver o resto sob
    demanda. Em tablet a grade original continua, com rolagem horizontal
    como rede de segurança para os módulos com mais colunas. */
export default function RegistryTable<T>({
  title,
  titleVariant = "brand",
  columns,
  rows,
  getRowId,
  selectedId,
  onSelect,
  tabs,
  activeTab,
  onTabChange,
  minRows = 7,
  footerActions,
  summary,
}: RegistryTableProps<T>) {
  const gridTemplate = columns.map((column) => column.width).join(" ");
  const tableMinWidth = columns.reduce((sum, column) => sum + columnMinWidth(column.width), 0);
  const placeholders = Math.max(0, minRows - rows.length);

  const primaryColumn = pickPrimaryColumn(columns);
  const codeColumn = columns.find((column) => column.key === "code" && column !== primaryColumn);
  const metaColumns = columns.filter((column) => column !== primaryColumn && column !== codeColumn);

  return (
    <section className="registry-table">
      {title && (
        <h2
          className={`registry-table__title${
            titleVariant === "plain" ? " registry-table__title--plain" : ""
          }`}
        >
          {title}
        </h2>
      )}

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
        {summary && summary.length > 0 && (
          <div className="registry-table__summary">
            {summary.map((item) => (
              <div
                key={item.label}
                className={`registry-table__summary-item registry-table__summary-item--${item.tone ?? "neutral"}`}
              >
                <span className="registry-table__summary-label">{item.label}</span>
                <span className="registry-table__summary-value">{item.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Tablet/desktop: grade original, com rolagem horizontal própria
            se a soma das colunas não couber — nunca aparece em mobile
            (ver breakpoint em RegistryTable.css), onde vira cards. */}
        <div className="registry-table__scroll">
          <div
            className="registry-table__header"
            style={{ gridTemplateColumns: gridTemplate, minWidth: tableMinWidth }}
          >
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
                  style={{ gridTemplateColumns: gridTemplate, minWidth: tableMinWidth }}
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
                style={{ gridTemplateColumns: gridTemplate, minWidth: tableMinWidth }}
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

        {/* Mobile: um card por registro — título (+ código, se houver)
            sempre visível, o resto dos campos num grid compacto de
            rótulo/valor. Só aparece abaixo do breakpoint mobile. */}
        <div className="registry-table__cards">
          {rows.map((row) => {
            const id = getRowId(row);
            return (
              <button
                key={id}
                className={`registry-table__card${selectedId === id ? " registry-table__card--selected" : ""}`}
                type="button"
                onClick={() => onSelect(id)}
              >
                <div className="registry-table__card-head">
                  {codeColumn && (
                    <span className="registry-table__card-code">{codeColumn.render(row)}</span>
                  )}
                  <span className="registry-table__card-title">{primaryColumn.render(row)}</span>
                </div>

                {metaColumns.length > 0 && (
                  <dl className="registry-table__card-meta">
                    {metaColumns.map((column) => (
                      <div className="registry-table__card-meta-item" key={column.key}>
                        <dt>{column.label}</dt>
                        <dd>{column.render(row)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </button>
            );
          })}

          {rows.length === 0 && <p className="registry-table__cards-empty">Nenhum registro encontrado.</p>}
        </div>

        {footerActions && footerActions.length > 0 && (
          <div className="registry-table__footer">
            {footerActions.map((action) => (
              <button
                key={action.id}
                className={`registry-table__footer-btn${
                  action.tone === "danger" ? " registry-table__footer-btn--danger" : ""
                }`}
                type="button"
                data-action={action.id}
                disabled={action.disabled}
                onClick={action.onClick}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
