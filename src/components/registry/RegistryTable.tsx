import { isValidElement, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  /**
   * Quando informado, clicar no cabeçalho **seleciona a coluna** em vez de
   * ordenar por ela. Existe para a prévia do construtor de módulos, onde o
   * cabeçalho é a forma de escolher qual campo o Inspetor edita — ordenar ali
   * não teria sentido, e ter os dois gestos no mesmo clique seria pior que
   * nenhum. Sem o prop, nada muda: a tabela publicada continua ordenando.
   */
  onColumnSelect?: (key: string) => void;
  /** Coluna em destaque; só faz efeito junto com `onColumnSelect`. */
  selectedColumnKey?: string | null;
};

/** Largura mínima assumida para uma coluna flexível (ex.: "minmax(0, 1fr)")
    ao calcular quanto a tabela precisa de largura antes de rolar na
    horizontal — abaixo disso o texto da coluna principal fica ilegível. */
const FLEX_COLUMN_MIN_WIDTH = 170;

function columnMinWidth(width: string): number {
  const px = /^(\d+(?:\.\d+)?)px$/.exec(width.trim());
  return px ? parseFloat(px[1]) : FLEX_COLUMN_MIN_WIDTH;
}

/** Extrai o texto puro de um ReactNode (string, número, ou elemento com
    filhos simples) para poder comparar valores de célula na ordenação —
    o mesmo conteúdo renderizado, sem markup. */
function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (isValidElement(node)) return extractText((node.props as { children?: ReactNode }).children);
  return "";
}

/** Interpreta um texto como número (aceita formato BR "1.234,56" e o
    formato simples "1234.56"). Retorna null se o texto não for numérico. */
function parseNumericText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const cleaned = trimmed.replace(/[^\d,.\-]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return null;
  const normalized = cleaned.includes(",") ? cleaned.replace(/\./g, "").replace(",", ".") : cleaned;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

type SortState = { key: string; direction: "asc" | "desc" };

/** Ordena as linhas já carregadas por uma coluna, sem nova consulta ao
    banco. Se todos os valores não-vazios da coluna parecerem numéricos,
    compara como número; senão, compara como texto (localeCompare). */
function sortRows<T>(rows: T[], columns: RegistryColumn<T>[], sort: SortState): T[] {
  const column = columns.find((c) => c.key === sort.key);
  if (!column) return rows;

  const texts = rows.map((row) => extractText(column.render(row)));
  const numbers = texts.map(parseNumericText);
  const isNumeric = numbers.every((n, i) => n !== null || texts[i].trim() === "");

  const indexed = rows.map((row, index) => ({ row, index }));
  indexed.sort((a, b) => {
    let cmp: number;
    if (isNumeric) {
      const na = numbers[a.index] ?? -Infinity;
      const nb = numbers[b.index] ?? -Infinity;
      cmp = na - nb;
    } else {
      cmp = texts[a.index].localeCompare(texts[b.index], "pt-BR", { sensitivity: "base" });
    }
    return sort.direction === "asc" ? cmp : -cmp;
  });

  return indexed.map((item) => item.row);
}

/** Liga um gradiente sutil no rodapé de um contêiner que rola por dentro
    enquanto ainda houver conteúdo abaixo da área visível — some assim que a
    pessoa rola até o fim (ver .registry-table__scroll-hint em
    RegistryTable.css). Recalcula ao rolar, ao trocar de dados e ao
    redimensionar a janela. */
function useScrollBottomHint(deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const [hasMore, setHasMore] = useState(false);

  function check() {
    const el = ref.current;
    if (!el) return;
    setHasMore(el.scrollHeight > el.clientHeight + el.scrollTop + 1);
  }

  useEffect(() => {
    check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  return { ref, hasMore, onScroll: check };
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
  minRows = 5,
  footerActions,
  summary,
  onColumnSelect,
  selectedColumnKey,
}: RegistryTableProps<T>) {
  const gridTemplate = columns.map((column) => column.width).join(" ");
  const tableMinWidth = columns.reduce((sum, column) => sum + columnMinWidth(column.width), 0);

  const [sort, setSort] = useState<SortState | null>(null);
  const sortedRows = useMemo(
    () => (sort ? sortRows(rows, columns, sort) : rows),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, sort],
  );
  const placeholders = Math.max(0, minRows - sortedRows.length);

  function handleSort(key: string) {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: "asc" };
      if (current.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  }

  const rowsHint = useScrollBottomHint([sortedRows, placeholders]);

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
        <div
          className={`registry-table__scroll${
            rowsHint.hasMore ? " registry-table__scroll--has-more" : ""
          }`}
        >
          <div
            className="registry-table__header"
            style={{ gridTemplateColumns: gridTemplate, minWidth: tableMinWidth }}
          >
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const picked = Boolean(onColumnSelect) && selectedColumnKey === column.key;
              return (
                <span key={column.key} style={{ textAlign: column.align ?? "left" }}>
                  <button
                    type="button"
                    className={`registry-table__sort-btn${active ? " registry-table__sort-btn--active" : ""}${
                      picked ? " registry-table__sort-btn--picked" : ""
                    }`}
                    onClick={() =>
                      onColumnSelect ? onColumnSelect(column.key) : handleSort(column.key)
                    }
                    aria-pressed={onColumnSelect ? picked : undefined}
                    aria-sort={
                      onColumnSelect
                        ? undefined
                        : active
                          ? sort!.direction === "asc"
                            ? "ascending"
                            : "descending"
                          : "none"
                    }
                  >
                    {column.label}
                    <span className="registry-table__sort-icon" aria-hidden="true">
                      {active ? (sort!.direction === "asc" ? "▲" : "▼") : ""}
                    </span>
                  </button>
                </span>
              );
            })}
          </div>

          <div className="registry-table__rows" ref={rowsHint.ref} onScroll={rowsHint.onScroll}>
            {sortedRows.map((row) => {
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

          <div className="registry-table__scroll-hint" aria-hidden="true" />
        </div>

        {/* Mobile: um card por registro — título (+ código, se houver)
            sempre visível, o resto dos campos num grid compacto de
            rótulo/valor. Só aparece abaixo do breakpoint mobile. */}
        <div className="registry-table__cards">
          {sortedRows.map((row) => {
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
