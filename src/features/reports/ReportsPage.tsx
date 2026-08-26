import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import * as XLSX from "xlsx";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import FormField from "../../components/form/FormField";
import SearchCombobox from "../../components/form/SearchCombobox";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryLayout, RegistryTable, type RegistryColumn, type RegistrySummaryItem } from "../../components/registry";
import { fetchContactsByKind } from "../../lib/repositories/contactLookups";
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
import { normalizeSearchText } from "../../lib/searchText";
import type { Tables } from "../../types/supabase";
import { useAuth } from "../auth/AuthContext";
import type { Contact } from "../customers/contacts";
import { computeCashFlowTotals, formatEntryTotal, type FinanceEntry } from "../finance/finance";
import { useFinancialEntriesData } from "../finance/useFinancialEntriesData";
import ModuleTile from "../home/components/ModuleTile";
import { ReportsIcon } from "../home/icons";
import type { Product } from "../products/products";
import { useProductsData } from "../products/useProductsData";
import { invoiceStatusLabel } from "../sales/invoices";
import {
  REPORT_DEFINITIONS,
  defaultRangeFor,
  formatReportAmount,
  formatReportDate,
  type ReportDefinition,
} from "./reports";
import "./ReportsPage.css";

/** Item selecionado no filtro de entidade (cliente/fornecedor/produto) — só o necessário para o chip e para a query. */
type EntitySelection = { id: string; label: string };

const MODULE_ID = "relatorios";

type ReportRow = Record<string, unknown>;
/** Coluna do relatório: além do `render` (JSX, para a tabela), toda coluna
    carrega `exportValue` — texto puro para a planilha .xlsx. Não dá pra
    extrair texto confiável de `render` (devolve ReactNode), então as duas
    funções são definidas juntas, a partir do mesmo dado tipado, em cada
    `build*Table`. */
type ReportColumn = RegistryColumn<ReportRow> & { exportValue: (row: ReportRow) => string };
type ReportTable = { columns: ReportColumn[]; rows: ReportRow[]; summary: RegistrySummaryItem[] };

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
  const dateCell = (r: ReportRow) => formatReportDate(r.saleDate as string);
  const countCell = (r: ReportRow) => String(r.saleCount);
  const totalCell = (r: ReportRow) => formatReportAmount(r.totalAmount as number);
  return {
    columns: [
      { key: "date", label: "Data", width: "140px", render: dateCell, exportValue: dateCell },
      { key: "count", label: "Vendas", width: "100px", align: "center", render: countCell, exportValue: countCell },
      {
        key: "total",
        label: "Total faturado",
        width: "160px",
        align: "right",
        render: totalCell,
        exportValue: totalCell,
      },
    ],
    rows: rows as unknown as ReportRow[],
    summary: [
      { label: "Total faturado no período", value: formatReportAmount(totalAmount), tone: "positive" },
      { label: "Quantidade de vendas", value: String(saleCount), tone: "neutral" },
    ],
  };
}

async function buildSalesByContactTable(branchId: string, range: DateRange, contactIds: string[]): Promise<ReportTable> {
  const rows = await fetchSalesByContact(branchId, range, contactIds);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const contactCell = (r: ReportRow) => r.contactName as string;
  const countCell = (r: ReportRow) => String(r.saleCount);
  const totalCell = (r: ReportRow) => formatReportAmount(r.totalAmount as number);
  return {
    columns: [
      { key: "contact", label: "Cliente", width: "minmax(0, 1fr)", primary: true, render: contactCell, exportValue: contactCell },
      { key: "count", label: "Vendas", width: "100px", align: "center", render: countCell, exportValue: countCell },
      {
        key: "total",
        label: "Total",
        width: "160px",
        align: "right",
        render: totalCell,
        exportValue: totalCell,
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
  productIds: string[],
): Promise<ReportTable> {
  const rows = await fetchSaleItemsByProduct(branchId, range, productIds);
  const sorted = [...rows].sort((a, b) =>
    sortBy === "total" ? b.totalAmount - a.totalAmount : b.quantity - a.quantity,
  );
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const quantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const codeCell = (r: ReportRow) => r.productCode as string;
  const descriptionCell = (r: ReportRow) => r.productDescription as string;
  const quantityCell = (r: ReportRow) => String(r.quantity);
  const totalCell = (r: ReportRow) => formatReportAmount(r.totalAmount as number);
  return {
    columns: [
      { key: "code", label: "Código", width: "90px", align: "center", render: codeCell, exportValue: codeCell },
      { key: "description", label: "Produto", width: "minmax(0, 1fr)", primary: true, render: descriptionCell, exportValue: descriptionCell },
      { key: "quantity", label: "Quantidade", width: "110px", align: "center", render: quantityCell, exportValue: quantityCell },
      {
        key: "total",
        label: "Total vendido",
        width: "150px",
        align: "right",
        render: totalCell,
        exportValue: totalCell,
      },
    ],
    rows: sorted as unknown as ReportRow[],
    summary: [
      { label: "Total vendido no período", value: formatReportAmount(totalAmount), tone: "positive" },
      { label: "Quantidade total", value: String(quantity), tone: "neutral" },
    ],
  };
}

async function buildPurchasesByContactTable(branchId: string, range: DateRange, contactIds: string[]): Promise<ReportTable> {
  const rows = await fetchPurchasesByContact(branchId, range, contactIds);
  const totalAmount = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  const contactCell = (r: ReportRow) => r.contactName as string;
  const countCell = (r: ReportRow) => String(r.purchaseCount);
  const totalCell = (r: ReportRow) => formatReportAmount(r.totalAmount as number);
  return {
    columns: [
      { key: "contact", label: "Fornecedor", width: "minmax(0, 1fr)", primary: true, render: contactCell, exportValue: contactCell },
      { key: "count", label: "Compras", width: "100px", align: "center", render: countCell, exportValue: countCell },
      {
        key: "total",
        label: "Total",
        width: "160px",
        align: "right",
        render: totalCell,
        exportValue: totalCell,
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
  productIds: string[],
): Promise<ReportTable> {
  const rows = await fetchPurchaseItemsByProduct(branchId, range, productIds);
  const sorted = [...rows].sort((a, b) => {
    if (sortBy === "quantity") return b.quantity - a.quantity;
    return (b.avgUnitCost ?? -1) - (a.avgUnitCost ?? -1);
  });
  const codeCell = (r: ReportRow) => r.productCode as string;
  const descriptionCell = (r: ReportRow) => r.productDescription as string;
  const quantityCell = (r: ReportRow) => String(r.quantity);
  const avgCostCell = (r: ReportRow) => (r.avgUnitCost !== null ? formatReportAmount(r.avgUnitCost as number) : "—");
  const totalCell = (r: ReportRow) => formatReportAmount(r.totalAmount as number);
  return {
    columns: [
      { key: "code", label: "Código", width: "90px", align: "center", render: codeCell, exportValue: codeCell },
      { key: "description", label: "Produto", width: "minmax(0, 1fr)", primary: true, render: descriptionCell, exportValue: descriptionCell },
      { key: "quantity", label: "Quantidade", width: "110px", align: "center", render: quantityCell, exportValue: quantityCell },
      {
        key: "avgCost",
        label: "Custo médio",
        width: "130px",
        align: "right",
        render: avgCostCell,
        exportValue: avgCostCell,
      },
      {
        key: "total",
        label: "Total comprado",
        width: "150px",
        align: "right",
        render: totalCell,
        exportValue: totalCell,
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
  const saleCell = (r: ReportRow) => (r.saleCode as string | null) ?? "—";
  const modelCell = (r: ReportRow) => (r.model === "nfce" ? "NFC-e" : "NF-e");
  const statusCell = (r: ReportRow) => invoiceStatusLabel({ status: r.status as Tables<"fiscal_documents">["status"] });
  const chaveCell = (r: ReportRow) => (r.chave as string | null) ?? "—";
  const createdAtCell = (r: ReportRow) => formatReportDate(r.createdAt as string);
  return {
    columns: [
      { key: "sale", label: "Venda", width: "100px", align: "center", render: saleCell, exportValue: saleCell },
      { key: "model", label: "Modelo", width: "90px", align: "center", render: modelCell, exportValue: modelCell },
      {
        key: "status",
        label: "Status",
        width: "160px",
        render: statusCell,
        exportValue: statusCell,
      },
      { key: "chave", label: "Chave de acesso", width: "minmax(0, 1fr)", render: chaveCell, exportValue: chaveCell },
      { key: "createdAt", label: "Emitida em", width: "140px", render: createdAtCell, exportValue: createdAtCell },
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
  const codeCell = (r: ReportRow) => r.code as string;
  const descriptionCell = (r: ReportRow) => r.description as string;
  const stockCell = (r: ReportRow) => String(r.stock);
  const minimumCell = (r: ReportRow) => String(r.minimumStock);
  return {
    columns: [
      { key: "code", label: "Código", width: "90px", align: "center", render: codeCell, exportValue: codeCell },
      { key: "description", label: "Produto", width: "minmax(0, 1fr)", primary: true, render: descriptionCell, exportValue: descriptionCell },
      { key: "stock", label: "Saldo atual", width: "120px", align: "center", render: stockCell, exportValue: stockCell },
      { key: "minimum", label: "Mínimo", width: "120px", align: "center", render: minimumCell, exportValue: minimumCell },
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

/** Roteia o id do bloco para o construtor de tabela certo — os 7 relatórios sem fonte já carregada no cliente (ver `financeTableFor` para os 2 que reaproveitam `useFinancialEntriesData`). `entityIds` só é usado pelos 4 relatórios `filterKind: "entity"`; os demais o ignoram. */
async function buildAsyncReportTable(
  id: string,
  branchId: string,
  range: DateRange,
  fiscalFilters: { model: string; status: string },
  entityIds: string[],
): Promise<ReportTable | null> {
  switch (id) {
    case "vendas-total":
    case "vendas-por-periodo":
      return buildSalesByDayTable(branchId, range);
    case "vendas-por-cliente":
      return buildSalesByContactTable(branchId, range, entityIds);
    case "vendas-por-produto":
      return buildSaleItemsByProductTable(branchId, range, "total", entityIds);
    case "produtos-mais-vendidos":
      return buildSaleItemsByProductTable(branchId, range, "quantity", entityIds);
    case "compras-por-fornecedor":
      return buildPurchasesByContactTable(branchId, range, entityIds);
    case "produtos-comprados":
      return buildPurchaseItemsByProductTable(branchId, range, "quantity", entityIds);
    case "custo-medio-compras":
      return buildPurchaseItemsByProductTable(branchId, range, "avgCost", entityIds);
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
    const settledAtCell = (r: ReportRow) => (r as FinanceEntry).settledAtFormatted;
    const typeCell = (r: ReportRow) => ((r as FinanceEntry).type === "a_pagar" ? "A pagar" : "A receber");
    const contactCell = (r: ReportRow) => (r as FinanceEntry).contactName || "—";
    const totalCell = (r: ReportRow) => formatEntryTotal((r as FinanceEntry).total);
    return {
      columns: [
        { key: "settledAt", label: "Baixado em", width: "130px", render: settledAtCell, exportValue: settledAtCell },
        {
          key: "type",
          label: "Tipo",
          width: "110px",
          render: typeCell,
          exportValue: typeCell,
        },
        { key: "contact", label: "Contato", width: "minmax(0, 1fr)", primary: true, render: contactCell, exportValue: contactCell },
        {
          key: "total",
          label: "Valor",
          width: "140px",
          align: "right",
          render: totalCell,
          exportValue: totalCell,
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
    const typeCell = (r: ReportRow) => ((r as FinanceEntry).type === "a_pagar" ? "A pagar" : "A receber");
    const contactCell = (r: ReportRow) => (r as FinanceEntry).contactName || "—";
    const dueDateCell = (r: ReportRow) => (r as FinanceEntry).dueDateFormatted;
    const totalCell = (r: ReportRow) => formatEntryTotal((r as FinanceEntry).total);
    return {
      columns: [
        {
          key: "type",
          label: "Tipo",
          width: "110px",
          render: typeCell,
          exportValue: typeCell,
        },
        { key: "contact", label: "Contato", width: "minmax(0, 1fr)", primary: true, render: contactCell, exportValue: contactCell },
        { key: "dueDate", label: "Vencimento", width: "130px", render: dueDateCell, exportValue: dueDateCell },
        {
          key: "total",
          label: "Valor",
          width: "140px",
          align: "right",
          render: totalCell,
          exportValue: totalCell,
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

/** "Vendas por cliente" -> "vendas-por-cliente" (sem acento) — nome do arquivo exportado. */
function slugifyReportLabel(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Planilha .xlsx a partir das linhas já mostradas na tela (respeita a busca da tabela) — uma aba, cabeçalho = rótulos das colunas. */
function exportReportToExcel(reportLabel: string, columns: ReportColumn[], rows: ReportRow[]): void {
  const header = columns.map((column) => column.label);
  const data = rows.map((row) => columns.map((column) => column.exportValue(row)));
  const sheet = XLSX.utils.aoa_to_sheet([header, ...data]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Relatório");
  const today = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `${slugifyReportLabel(reportLabel)}-${today}.xlsx`);
}

/**
 * Busca de produto do filtro de entidade — em JS, sobre a lista já carregada
 * da filial (mesma técnica do `ProductPickerPanel`), não existe hoje uma
 * busca de produto por servidor para reaproveitar no `SearchCombobox`.
 */
function searchLocalProducts(products: Product[], query: string): Promise<Product[]> {
  const term = normalizeSearchText(query.trim());
  const active = products.filter((p) => p.active);
  const filtered = term
    ? active.filter(
        (p) => normalizeSearchText(p.description).includes(term) || normalizeSearchText(p.code).includes(term),
      )
    : active;
  return Promise.resolve(filtered.slice(0, 20));
}

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

  // Filtro de entidade (cliente/fornecedor/produto) dos 4 blocos `filterKind: "entity"`.
  // Seleção vazia = comportamento padrão (traz tudo), como antes desse filtro existir.
  const [entitySelection, setEntitySelection] = useState<EntitySelection[]>([]);
  const [entityQuery, setEntityQuery] = useState("");
  const entityIds = useMemo(() => entitySelection.map((item) => item.id), [entitySelection]);

  // Busca na tabela já carregada — em cima do que está renderizado (mesma
  // coluna que o operador vê), não da linha crua: os 12 relatórios têm
  // colunas diferentes entre si, então filtrar aqui, uma vez, no componente
  // que já monta a tabela genérica (`ReportTable`), evita repetir a mesma
  // lógica em cada um dos `build*Table`.
  const [tableSearch, setTableSearch] = useState("");

  const [asyncTable, setAsyncTable] = useState<ReportTable | null>(null);
  const [asyncLoading, setAsyncLoading] = useState(false);
  const [asyncError, setAsyncError] = useState<string | null>(null);

  const { entries: financeEntries } = useFinancialEntriesData(currentBranchId);
  // Carregado sempre (não só quando um relatório "product" está aberto): mesmo
  // padrão do `ProductPickerPanel`, que também busca a lista inteira da filial
  // e filtra em JS — não existe hoje uma busca de produto por servidor.
  const { products: allProducts } = useProductsData(currentBranchId);

  useEffect(() => {
    openWindow({ id: "relatorios", label: "Relatórios", path: "/relatorios", icon: ReportsIcon });
  }, [openWindow]);

  useEffect(() => {
    if (active) setRange(defaultRangeFor(active.filterKind));
    setEntitySelection([]);
    setEntityQuery("");
    setTableSearch("");
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
    buildAsyncReportTable(active.id, currentBranchId, range, { model: fiscalModel, status: fiscalStatus }, entityIds)
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
  }, [active, currentBranchId, range, fiscalModel, fiscalStatus, entityIds]);

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

  /** Linhas depois da busca — compara contra o texto de cada coluna já formatado (o que o operador vê), não os valores crus da linha. */
  const visibleRows = useMemo(() => {
    const term = normalizeSearchText(tableSearch.trim());
    if (!term) return rowsWithId;
    const columns = table?.columns ?? [];
    return rowsWithId.filter((row) =>
      columns.some((column) => normalizeSearchText(String(column.render(row))).includes(term)),
    );
  }, [rowsWithId, table, tableSearch]);

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
    <AppShell navItems={navItems} secondaryText="Relatórios" contentTone="blue" fillViewport onBack={() => setActiveId(null)}>
      <div className="reports-detail">
        <div className="reports-detail__toolbar">
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
        </div>

        {active.filterKind === "entity" && active.entityKind && (
          <div className="reports-detail__entity-filter">
            {active.entityKind === "contact" ? (
              <SearchCombobox<Contact>
                id="report-entity-contact"
                label={active.id === "compras-por-fornecedor" ? "Fornecedor" : "Cliente"}
                placeholder="Digite o nome ou o documento para filtrar..."
                value={entityQuery}
                onChange={setEntityQuery}
                fetchItems={(query) =>
                  fetchContactsByKind(active.id === "compras-por-fornecedor" ? "fornecedores" : "clientes", query)
                }
                getKey={(c) => c.id}
                renderItem={(c) => ({ primary: c.name, secondary: c.document })}
                onSelect={(c) => {
                  setEntitySelection((current) =>
                    current.some((item) => item.id === c.id) ? current : [...current, { id: c.id, label: c.name }],
                  );
                  setEntityQuery("");
                }}
                closeOnSelect={false}
                openAbove
                hint={entitySelection.length === 0 ? "Nenhum selecionado: mostra todos no período." : undefined}
              />
            ) : (
              <SearchCombobox<Product>
                id="report-entity-product"
                label="Produto"
                placeholder="Digite o código ou a descrição para filtrar..."
                value={entityQuery}
                onChange={setEntityQuery}
                fetchItems={(query) => searchLocalProducts(allProducts, query)}
                getKey={(p) => p.id}
                renderItem={(p) => ({ primary: p.description, secondary: p.code })}
                onSelect={(p) => {
                  setEntitySelection((current) =>
                    current.some((item) => item.id === p.id) ? current : [...current, { id: p.id, label: p.description }],
                  );
                  setEntityQuery("");
                }}
                closeOnSelect={false}
                openAbove
                hint={entitySelection.length === 0 ? "Nenhum selecionado: mostra todos no período." : undefined}
              />
            )}

            {entitySelection.length > 0 && (
              <div className="reports-detail__chips">
                {entitySelection.map((item) => (
                  <span key={item.id} className="reports-detail__chip">
                    {item.label}
                    <button
                      type="button"
                      className="reports-detail__chip-remove"
                      onClick={() => setEntitySelection((current) => current.filter((i) => i.id !== item.id))}
                      aria-label={`Remover ${item.label} do filtro`}
                    >
                      ×
                    </button>
                  </span>
                ))}
                <button type="button" className="reports-detail__chip-clear" onClick={() => setEntitySelection([])}>
                  Limpar seleção
                </button>
              </div>
            )}
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

        <div className="reports-detail__table-search">
          <FormField
            id="report-table-search"
            label="Buscar na tabela"
            type="text"
            value={tableSearch}
            onChange={setTableSearch}
            hint="Filtra as linhas mostradas abaixo por qualquer coluna."
          />
        </div>

        <RegistryLayout variant="single">
          <RegistryTable
            columns={table?.columns ?? []}
            rows={visibleRows}
            getRowId={(row) => row.__reportRowId as string}
            selectedId={null}
            onSelect={() => {}}
            summary={table?.summary}
            footerActions={[
              {
                id: "export-excel",
                label: "Exportar EXCEL",
                disabled: !table || visibleRows.length === 0,
                onClick: () => table && exportReportToExcel(active.label, table.columns, visibleRows),
              },
              {
                id: "print-pdf",
                label: "Imprimir/PDF",
                disabled: !table,
                onClick: () => window.print(),
              },
            ]}
          />
        </RegistryLayout>
      </div>
    </AppShell>
  );
}
