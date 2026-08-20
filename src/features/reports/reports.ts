import type { ComponentType, SVGProps } from "react";
import { todayIso } from "../finance/finance";
import {
  ClientsIcon,
  FinanceIcon,
  InvoicesIcon,
  ProductsIcon,
  PurchasesIcon,
  SaleHandIcon,
} from "../home/icons";
import { CalendarIcon, LowStockIcon, TopSellerIcon, AverageCostIcon } from "./reportIcons";

/**
 * Como o bloco decide o intervalo padrão de data — decisão registrada aqui
 * (não em cada componente) para ficar num lugar só:
 * - "period": relatório de série temporal — mês corrente até hoje. Histórico
 *   inteiro sem filtro ficaria pesado e ilegível.
 * - "entity": relatório por cliente/produto/fornecedor — últimos 90 dias.
 *   Mais largo que "period" de propósito (é comum querer ver "os melhores
 *   clientes/produtos" numa janela maior que um mês), mas ainda limitado —
 *   não é "todo o histórico" só porque o ambiente de teste é pequeno hoje.
 * - "status": filtra por categoria (modelo/status), não por data — mostra
 *   tudo por padrão, sem tornar o filtro de data uma pergunta sem resposta
 *   óbvia (ex.: "Notas fiscais emitidas").
 * - "none": sem filtro nenhum — snapshot do estado atual (ex.: estoque
 *   abaixo do mínimo, contas em aberto).
 */
export type ReportFilterKind = "period" | "entity" | "status" | "none";

export type ReportDefinition = {
  id: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  description: string;
  filterKind: ReportFilterKind;
  /**
   * Módulo de origem cujo `has_permission(..., 'view')` realmente decide o
   * que a view/tabela deste relatório devolve (camada 1 da RLS, ver
   * AGENTS.md). Usado só para mostrar um aviso amigável — quem barra de
   * verdade é a RLS da tabela de origem, não esta checagem.
   */
  sourceModuleId: string;
};

export const REPORT_DEFINITIONS: ReportDefinition[] = [
  {
    id: "vendas-total",
    label: "Vendas (Total Faturado)",
    icon: SaleHandIcon,
    description: "Soma de sales.total_amount por período.",
    filterKind: "period",
    sourceModuleId: "realizar-venda",
  },
  {
    id: "vendas-por-cliente",
    label: "Vendas por cliente",
    icon: ClientsIcon,
    description: "Vendas agrupadas por contact_id.",
    filterKind: "entity",
    sourceModuleId: "realizar-venda",
  },
  {
    id: "vendas-por-produto",
    label: "Vendas por produto",
    icon: ProductsIcon,
    description: "sale_items agrupado por product_id.",
    filterKind: "entity",
    sourceModuleId: "realizar-venda",
  },
  {
    id: "vendas-por-periodo",
    label: "Vendas por período",
    icon: CalendarIcon,
    description: "Vendas em série temporal.",
    filterKind: "period",
    sourceModuleId: "realizar-venda",
  },
  {
    id: "compras-por-fornecedor",
    label: "Compras por fornecedor",
    icon: PurchasesIcon,
    description: "Compras agrupadas por contact_id.",
    filterKind: "entity",
    sourceModuleId: "compras",
  },
  {
    id: "produtos-comprados",
    label: "Produtos comprados",
    icon: ProductsIcon,
    description: "purchase_items agrupado por product_id.",
    filterKind: "entity",
    sourceModuleId: "compras",
  },
  {
    id: "custo-medio-compras",
    label: "Custo médio de compras",
    icon: AverageCostIcon,
    description: "Média de purchase_items.unit_cost, por produto.",
    filterKind: "entity",
    sourceModuleId: "compras",
  },
  {
    id: "financeiro-fluxo-caixa",
    label: "Financeiro (fluxo de caixa)",
    icon: FinanceIcon,
    description: "financial_entries baixados, entradas/saídas por período.",
    filterKind: "period",
    sourceModuleId: "financeiro",
  },
  {
    id: "contas-a-pagar-receber",
    label: "Contas a pagar/receber",
    icon: FinanceIcon,
    description: "financial_entries em aberto, por tipo.",
    filterKind: "none",
    sourceModuleId: "financeiro",
  },
  {
    id: "notas-fiscais-emitidas",
    label: "Notas fiscais emitidas",
    icon: InvoicesIcon,
    description: "fiscal_documents, com filtro por modelo/status.",
    filterKind: "status",
    sourceModuleId: "notas-emitidas",
  },
  {
    id: "produtos-mais-vendidos",
    label: "Produtos mais vendidos",
    icon: TopSellerIcon,
    description: "sale_items agrupado por product_id, ordenado por quantidade.",
    filterKind: "entity",
    sourceModuleId: "realizar-venda",
  },
  {
    id: "estoque-abaixo-minimo",
    label: "Estoque abaixo do mínimo",
    icon: LowStockIcon,
    description: "products com stock abaixo de minimum_stock.",
    filterKind: "none",
    sourceModuleId: "produtos",
  },
];

/** `YYYY-MM-01` do mês corrente — início da janela padrão dos relatórios "period". */
export function startOfCurrentMonthIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${now.getFullYear()}-${month}-01`;
}

/** `hoje - n dias`, em ISO — início da janela padrão dos relatórios "entity" (n=90). */
export function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Intervalo padrão de um relatório, pelo `filterKind` — usado ao abrir o bloco e ao trocar de bloco. */
export function defaultRangeFor(kind: ReportFilterKind): { from: string; to: string } {
  const to = todayIso();
  if (kind === "period") return { from: startOfCurrentMonthIso(), to };
  if (kind === "entity") return { from: isoDaysAgo(90), to };
  return { from: to, to };
}

/** Formato monetário do sistema (pt-BR, sem símbolo). */
export function formatReportAmount(value: number) {
  return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** `date` do Postgres (`2026-08-20`) formatada sem passar por `Date` (mesmo cuidado de fuso de `finance.ts`). */
export function formatReportDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return "";
  return `${day}/${month}/${year}`;
}
