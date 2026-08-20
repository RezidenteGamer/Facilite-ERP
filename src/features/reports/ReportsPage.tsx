import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import FormField from "../../components/form/FormField";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryLayout, RegistryTable, type RegistryColumn, type RegistrySummaryItem } from "../../components/registry";
import {
  fetchFiscalDocumentsReport,
  fetchLowStockProducts,
  fetchPurchaseItemsByProduct,
  fetchPurchasesByContact,
  fetchSaleItemsByProduct,
  fetchSalesByContact,
  fetchSalesByDay,
  type DateRange,
} from "../../lib/repositories/reportsRepository";
import type { Tables } from "../../types/supabase";
import { useAuth } from "../auth/AuthContext";
import { computeCashFlowTotals, formatEntryTotal, type FinanceEntry } from "../finance/finance";
import { useFinancialEntriesData } from "../finance/useFinancialEntriesData";
import ModuleTile from "../home/components/ModuleTile";
import { ReportsIcon } from "../home/icons";
import { invoiceStatusLabel } from "../sales/invoices";
import {
  REPORT_DEFINITIONS,
  defaultRangeFor,
  formatReportAmount,
  formatReportDate,
  type ReportDefinition,
} from "./reports";
import "./ReportsPage.css";

const MODULE_ID = "relatorios";

type ReportRow = Record<string, unknown>;
type ReportTable = { columns: RegistryColumn<ReportRow>[]; rows: ReportRow[]; summary: RegistrySummaryItem[] };

const FISCAL_MODEL_OPTIONS = [
  { value: "", label: "Todos os modelos" },
  { value: "nfe", label: "NF-e" },
  { value: "nfce", label: "NFC-e" },
];

const FISCAL_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Todos os status" },
  { value: "autorizado", label: "Autorizado" },
  { value: "processando_autorizacao", label: "Processando" },
  { value: "erro_autorizacao", label: "Erro na emissão" },
  { value: "denegado", label: "Denegado" },
  { value: "cancelado", label: "Cancelado" },
];

/** Colunas + linhas de "Vendas (Total Faturado)"/"Vendas por período" — mesma view (`report_sales_by_day`), grão diário. */
async function buildSalesByDayTable(branchId: string, range: DateRange): Promise<ReportTable> {
  const rows = await fetchSalesByDay(branchId, range);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const saleCount = rows.reduce((sum, row) => sum + row.saleCount, 0);
  return {
    columns: [
      { key: "date", label: "Data", width: "140px", render: (r) => formatReportDate(r.saleDate as string) },
      { key: "count", label: "Vendas", width: "100px", align: "center", render: (r) => String(r.saleCount) },
      {
        key: "total",
        label: "Total faturado",
        width: "160px",
        align: "right",
        render: (r) => formatReportAmount(r.totalAmount as number),
      },
    ],
    rows: rows as unknown as ReportRow[],
    summary: [
      { label: "Total faturado no período", value: formatReportAmount(totalAmount), tone: "positive" },
      { label: "Quantidade de vendas", value: String(saleCount), tone: "neutral" },
    ],
  };
}

async function buildSalesByContactTable(branchId: string, range: DateRange): Promise<ReportTable> {
  const rows = await fetchSalesByContact(branchId, range);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  return {
    columns: [
      { key: "contact", label: "Cliente", width: "minmax(0, 1fr)", primary: true, render: (r) => r.contactName as string },
      { key: "count", label: "Vendas", width: "100px", align: "center", render: (r) => String(r.saleCount) },
      {
        key: "total",
        label: "Total",
        width: "160px",
        align: "right",
        render: (r) => formatReportAmount(r.totalAmount as number),
      },
    ],
    rows: rows as unknown as ReportRow[],
    summary: [{ label: "Total faturado no período", value: formatReportAmount(totalAmount), tone: "positive" }],
  };
}

/** "Vendas por produto" (ordena por valor) e "Produtos mais vendidos" (ordena por quantidade) — mesma fonte. */
async function buildSaleItemsByProductTable(
  branchId: string,
  range: DateRange,
  sortBy: "total" | "quantity",
): Promise<ReportTable> {
  const rows = await fetchSaleItemsByProduct(branchId, range);
  const sorted = [...rows].sort((a, b) =>
    sortBy === "total" ? b.totalAmount - a.totalAmount : b.quantity - a.quantity,
  );
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  return {
    columns: [
      { key: "code", label: "Código", width: "90px", align: "center", render: (r) => r.productCode as string },
      { key: "description", label: "Produto", width: "minmax(0, 1fr)", primary: true, render: (r) => r.productDescription as string },
      { key: "quantity", label: "Quantidade", width: "110px", align: "center", render: (r) => String(r.quantity) },
      {
        key: "total",
        label: "Total vendido",
        width: "150px",
        align: "right",
        render: (r) => formatReportAmount(r.totalAmount as number),
      },
    ],
    rows: sorted as unknown as ReportRow[],
    summary: [
      { label: "Total vendido no período", value: formatReportAmount(totalAmount), tone: "positive" },
      { label: "Quantidade total", value: String(quantity), tone: "neutral" },
    ],
  };
}

async function buildPurchasesByContactTable(branchId: string, range: DateRange): Promise<ReportTable> {
  const rows = await fetchPurchasesByContact(branchId, range);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  return {
    columns: [
      { key: "contact", label: "Fornecedor", width: "minmax(0, 1fr)", primary: true, render: (r) => r.contactName as string },
      { key: "count", label: "Compras", width: "100px", align: "center", render: (r) => String(r.purchaseCount) },
      {
        key: "total",
        label: "Total",
        width: "160px",
        align: "right",
        render: (r) => formatReportAmount(r.totalAmount as number),
      },
    ],
    rows: rows as unknown as ReportRow[],
    summary: [{ label: "Total comprado no período", value: formatReportAmount(totalAmount), tone: "negative" }],
  };
}

/** "Produtos comprados" (ordena por quantidade) e "Custo médio de compras" (ordena por custo médio) — mesma fonte. */
async function buildPurchaseItemsByProductTable(
  branchId: string,
  range: DateRange,
  sortBy: "quantity" | "avgCost",
): Promise<ReportTable> {
  const rows = await fetchPurchaseItemsByProduct(branchId, range);
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "quantity") return b.quantity - a.quantity;
    return (b.avgUnitCost ?? -1) - (a.avgUnitCost ?? -1);
  });
  return {
    columns: [
      { key: "code", label: "Código", width: "90px", align: "center", render: (r) => r.productCode as string },
      { key: "description", label: "Produto", width: "minmax(0, 1fr)", primary: true, render: (r) => r.productDescription as string },
      { key: "quantity", label: "Quantidade", width: "110px", align: "center", render: (r) => String(r.quantity) },
      {
        key: "avgCost",
        label: "Custo médio",
        width: "130px",
        align: "right",
        render: (r) => (r.avgUnitCost !== null ? formatReportAmount(r.avgUnitCost as number) : "—"),
      },
      {
        key: "total",
        label: "Total comprado",
        width: "150px",
        align: "right",
        render: (r) => formatReportAmount(r.totalAmount as number),
      },
    ],
    rows: sorted as unknown as ReportRow[],
    summary: [{ label: "Produtos distintos comprados", value: String(rows.length), tone: "neutral" }],
  };
}

async function buildFiscalDocumentsTable(
  branchId: string,
  filters: { model: string; status: string },
): Promise<ReportTable> {
  const rows = await fetchFiscalDocumentsReport(branchId, {
    model: filters.model ? (filters.model as "nfe" | "nfce") : undefined,
    status: filters.status ? (filters.status as Tables<"fiscal_documents">["status"]) : undefined,
  });
  const autorizadas = rows.filter((r) => r.status === "autorizado").length;
  return {
    columns: [
      { key: "sale", label: "Venda", width: "100px", align: "center", render: (r) => (r.saleCode as string | null) ?? "—" },
      { key: "model", label: "Modelo", width: "90px", align: "center", render: (r) => (r.model === "nfce" ? "NFC-e" : "NF-e") },
      {
        key: "status",
        label: "Status",
        width: "160px",
        render: (r) => invoiceStatusLabel({ status: r.status as Tables<"fiscal_documents">["status"] }),
      },
      { key: "chave", label: "Chave de acesso", width: "minmax(0, 1fr)", render: (r) => (r.chave as string | null) ?? "—" },
      { key: "createdAt", label: "Emitida em", width: "140px", render: (r) => formatReportDate(r.createdAt as string) },
    ],
    rows: rows as unknown as ReportRow[],
    summary: [
      { label: "Total de notas", value: String(rows.length), tone: "neutral" },
      { label: "Autorizadas", value: String(autorizadas), tone: "positive" },
    ],
  };
}

async function buildLowStockTable(branchId: string): Promise<ReportTable> {
  const rows = await fetchLowStockProducts(branchId);
  return {
    columns: [
      { key: "code", label: "Código", width: "90px", align: "center", render: (r) => r.code as string },
      { key: "description", label: "Produto", width: "minmax(0, 1fr)", primary: true, render: (r) => r.description as string },
      { key: "stock", label: "Saldo atual", width: "120px", align: "center", render: (r) => String(r.stock) },
      { key: "minimum", label: "Mínimo", width: "120px", align: "center", render: (r) => String(r.minimumStock) },
    ],
    rows: rows as unknown as ReportRow[],
    summary: [
      {
        label: "Produtos abaixo do mínimo",
        value: String(rows.length),
        tone: rows.length > 0 ? "negative" : "positive",
      },
    ],
  };
}

/** Roteia o id do bloco para o construtor de tabela certo — os 7 relatórios sem fonte já carregada no cliente (ver `financeTableFor` para os 2 que reaproveitam `useFinancialEntriesData`). */
async function buildAsyncReportTable(
  id: string,
  branchId: string,
  range: DateRange,
  fiscalFilters: { model: string; status: string },
): Promise<ReportTable | null> {
  switch (id) {
    case "vendas-total":
    case "vendas-por-periodo":
      return buildSalesByDayTable(branchId, range);
    case "vendas-por-cliente":
      return buildSalesByContactTable(branchId, range);
    case "vendas-por-produto":
      return buildSaleItemsByProductTable(branchId, range, "total");
    case "produtos-mais-vendidos":
      return buildSaleItemsByProductTable(branchId, range, "quantity");
    case "compras-por-fornecedor":
      return buildPurchasesByContactTable(branchId, range);
    case "produtos-comprados":
      return buildPurchaseItemsByProductTable(branchId, range, "quantity");
    case "custo-medio-compras":
      return buildPurchaseItemsByProductTable(branchId, range, "avgCost");
    case "notas-fiscais-emitidas":
      return buildFiscalDocumentsTable(branchId, fiscalFilters);
    case "estoque-abaixo-minimo":
      return buildLowStockTable(branchId);
    default:
      return null;
  }
}

/** Os 2 relatórios de Financeiro reaproveitam `useFinancialEntriesData` (já carregada na página) e `computeCashFlowTotals` — nunca reconsultam o banco por conta própria. */
function financeTableFor(id: string, entries: FinanceEntry[], range: DateRange): ReportTable | null {
  if (id === "financeiro-fluxo-caixa") {
    const rows = entries.filter(
      (entry) =>
        entry.status === "baixado" &&
        entry.settledAt &&
        entry.settledAt.slice(0, 10) >= range.from &&
        entry.settledAt.slice(0, 10) <= range.to,
    );
    const { entrou, saiu, saldo } = computeCashFlowTotals(rows);
    return {
      columns: [
        { key: "settledAt", label: "Baixado em", width: "130px", render: (r) => (r as FinanceEntry).settledAtFormatted },
        {
          key: "type",
          label: "Tipo",
          width: "110px",
          render: (r) => ((r as FinanceEntry).type === "a_pagar" ? "A pagar" : "A receber"),
        },
        { key: "contact", label: "Contato", width: "minmax(0, 1fr)", primary: true, render: (r) => (r as FinanceEntry).contactName || "—" },
        {
          key: "total",
          label: "Valor",
          width: "140px",
          align: "right",
          render: (r) => formatEntryTotal((r as FinanceEntry).total),
        },
      ],
      rows: rows as unknown as ReportRow[],
      summary: [
        { label: "Entrou", value: formatEntryTotal(entrou), tone: "positive" },
        { label: "Saiu", value: formatEntryTotal(saiu), tone: "negative" },
        { label: "Saldo", value: formatEntryTotal(saldo), tone: saldo >= 0 ? "positive" : "negative" },
      ],
    };
  }
  if (id === "contas-a-pagar-receber") {
    const rows = entries.filter((entry) => entry.status === "aberto");
    const aPagar = rows.filter((entry) => entry.type === "a_pagar").reduce((sum, entry) => sum + entry.total, 0);
    const aReceber = rows.filter((entry) => entry.type === "a_receber").reduce((sum, entry) => sum + entry.total, 0);
    return {
      columns: [
        {
          key: "type",
          label: "Tipo",
          width: "110px",
          render: (r) => ((r as FinanceEntry).type === "a_pagar" ? "A pagar" : "A receber"),
        },
        { key: "contact", label: "Contato", width: "minmax(0, 1fr)", primary: true, render: (r) => (r as FinanceEntry).contactName || "—" },
        { key: "dueDate", label: "Vencimento", width: "130px", render: (r) => (r as FinanceEntry).dueDateFormatted },
        {
          key: "total",
          label: "Valor",
          width: "140px",
          align: "right",
          render: (r) => formatEntryTotal((r as FinanceEntry).total),
        },
      ],
      rows: rows as unknown as ReportRow[],
      summary: [
        { label: "Total a pagar (aberto)", value: formatEntryTotal(aPagar), tone: "negative" },
        { label: "Total a receber (aberto)", value: formatEntryTotal(aReceber), tone: "positive" },
      ],
    };
  }
  return null;
}

const FINANCE_REPORT_IDS = new Set(["financeiro-fluxo-caixa", "contas-a-pagar-receber"]);

/**
 * Tela de Relatórios (etapa 11) — grade de 12 blocos e, ao abrir um, filtro +
 * tabela + resumo. Bespoke (não é motor genérico nem de lote): cada bloco lê
 * uma fonte diferente e não é um CRUD de uma tabela só. A permissão em duas
 * camadas está documentada no AGENTS.md — esta tela só decide se a pessoa
 * *entra*; o que cada bloco *mostra* é decidido pela RLS das tabelas de
 * origem (herdada pelas views via `security_invoker`).
 */
export default function ReportsPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");

  const [activeId, setActiveId] = useState<string | null>(null);
  const active: ReportDefinition | null = REPORT_DEFINITIONS.find((r) => r.id === activeId) ?? null;

  const [range, setRange] = useState<DateRange>(() => defaultRangeFor("period"));
  const [fiscalModel, setFiscalModel] = useState("");
  const [fiscalStatus, setFiscalStatus] = useState("");

  const [asyncTable, setAsyncTable] = useState<ReportTable | null>(null);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const [asyncError, setAsyncError] = useState<string | null>(null);

  const { entries: financeEntries } = useFinancialEntriesData(currentBranchId);

  useEffect(() => {
    openWindow({ id: "relatorios", label: "Relatórios", path: "/relatorios", icon: ReportsIcon });
  }, [openWindow]);

  useEffect(() => {
    if (active) setRange(defaultRangeFor(active.filterKind));
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    if (!active || !currentBranchId || FINANCE_REPORT_IDS.has(active.id)) {
      setAsyncTable(null);
      setAsyncError(null);
      return;
    }
    setAsyncLoading(true);
    setAsyncError(null);
    buildAsyncReportTable(active.id, currentBranchId, range, { model: fiscalModel, status: fiscalStatus })
      .then((table) => {
        if (!cancelled) setAsyncTable(table);
      })
      .catch((err) => {
        if (!cancelled) setAsyncError(err instanceof Error ? err.message : "Erro ao carregar o relatório.");
      })
      .finally(() => {
        if (!cancelled) setAsyncLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, currentBranchId, range, fiscalModel, fiscalStatus]);

  const table: ReportTable | null = useMemo(() => {
    if (!active) return null;
    if (FINANCE_REPORT_IDS.has(active.id)) return financeTableFor(active.id, financeEntries, range);
    return asyncTable;
  }, [active, financeEntries, range, asyncTable]);

  /** `RegistryTable` precisa de um id por linha — as linhas de relatório não têm um `id` de tabela em comum entre si (join agregado), então o índice basta (a lista é reconstruída inteira a cada consulta, nunca editada em posição). */
  const rowsWithId = useMemo(
    () => (table?.rows ?? []).map((row, index) => ({ ...row, __reportRowId: String(index) })),
    [table],
  );

  const sourceViewAllowed = active ? hasPermission(active.sourceModuleId, "view") : true;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Relatórios" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Você não tem permissão para acessar este módulo.</p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Relatórios" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : "Selecione uma filial no menu \"Filiais\" para ver os relatórios."}
        </p>
      </AppShell>
    );
  }

  if (!active) {
    return (
      <AppShell navItems={navItems} secondaryText="Relatórios" contentTone="blue" fillViewport>
        <div className="reports-grid">
          {REPORT_DEFINITIONS.map((report) => (
            <ModuleTile key={report.id} module={report} onSelect={() => setActiveId(report.id)} />
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Relatórios" contentTone="blue" fillViewport>
      <div className="reports-detail">
        <div className="reports-detail__header">
          <button type="button" className="reports-detail__back" onClick={() => setActiveId(null)}>
            ← Voltar
          </button>
          <h2 className="reports-detail__title">{active.label}</h2>
        </div>

        {(active.filterKind === "period" || active.filterKind === "entity") && (
          <div className="reports-detail__filters">
            <FormField id="report-from" label="De" type="date" value={range.from} onChange={(value) => setRange((r) => ({ ...r, from: value }))} />
            <FormField id="report-to" label="Até" type="date" value={range.to} onChange={(value) => setRange((r) => ({ ...r, to: value }))} />
          </div>
        )}

        {active.filterKind === "status" && (
          <div className="reports-detail__filters">
            <FormField
              id="report-model"
              label="Modelo"
              type="select"
              value={fiscalModel}
              options={FISCAL_MODEL_OPTIONS}
              onChange={setFiscalModel}
            />
            <FormField
              id="report-status"
              label="Status"
              type="select"
              value={fiscalStatus}
              options={FISCAL_STATUS_OPTIONS}
              onChange={setFiscalStatus}
            />
          </div>
        )}

        {!sourceViewAllowed && (
          <p className="reports-detail__warning">
            Você não tem permissão de visualização em "{active.sourceModuleId}" — este relatório fica vazio até essa
            permissão ser concedida, mesmo com acesso a Relatórios.
          </p>
        )}

        {asyncError && <p className="reports-detail__error">{asyncError}</p>}
        {asyncLoading && <p className="reports-detail__loading">Carregando…</p>}

        <RegistryLayout variant="single">
          <RegistryTable
            columns={table?.columns ?? []}
            rows={rowsWithId}
            getRowId={(row) => row.__reportRowId as string}
            selectedId={null}
            onSelect={() => {}}
            summary={table?.summary}
          />
        </RegistryLayout>
      </div>
    </AppShell>
  );
}
