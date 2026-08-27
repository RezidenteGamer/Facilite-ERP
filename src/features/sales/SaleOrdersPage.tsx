import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { normalizeSearchText } from "../../lib/searchText";
import { SaleOrdersIcon } from "../home/icons";
import { SALE_PAYMENT_METHOD_LABEL } from "./sales";
import { SALE_ORDER_STATUS_LABEL, formatOrderTotal, type SaleOrder } from "./saleOrders";
import SaleOrderPreviewModal from "./SaleOrderPreviewModal";
import { useSaleOrdersData } from "./useSaleOrdersData";

const COLUNAS: RegistryColumn<SaleOrder>[] = [
  { key: "code", label: "Codigo", width: "90px", align: "center", render: (o) => o.code },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", render: (o) => o.contactName },
  {
    key: "paymentMethod",
    label: "Forma de pagamento",
    width: "200px",
    render: (o) => SALE_PAYMENT_METHOD_LABEL[o.paymentMethod],
  },
  { key: "installments", label: "Parcelas", width: "110px", align: "center", render: (o) => o.installments },
  {
    key: "total",
    label: "Valor total",
    width: "130px",
    align: "center",
    render: (o) => formatOrderTotal(o.totalAmount),
  },
];

/** Módulo "Pedidos de venda". */
export default function SaleOrdersPage() {
  const navigate = useNavigate();
  const { openWindow, updateWindowPath } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();
  const { orders, loading, error, convertToSale } = useSaleOrdersData(currentBranchId);

  const canCreate = hasPermission("pedidos-venda", "create");
  const canEdit = hasPermission("pedidos-venda", "edit");

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmingConvert, setConfirmingConvert] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [convertedMessage, setConvertedMessage] = useState<string | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  useEffect(() => {
    openWindow({
      id: "pedidos-venda",
      label: "Pedidos de venda",
      path: "/pedidos-venda",
      icon: SaleOrdersIcon,
    });
    // Garante que voltar para a lista pelo dock aponte para cá mesmo quando
    // o formulário "novo" registrou a janela primeiro — ver `SaleOrderFormPage.tsx`.
    updateWindowPath("pedidos-venda", "/pedidos-venda");
  }, [openWindow, updateWindowPath]);

  useEffect(() => {
    if (selectedId && !orders.some((o) => o.id === selectedId)) setSelectedId(null);
  }, [orders, selectedId]);

  const visibleOrders = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    if (!term) return orders;
    return orders.filter(
      (order) => normalizeSearchText(order.contactName).includes(term) || normalizeSearchText(order.code).includes(term),
    );
  }, [orders, search]);

  const selected: SaleOrder | null = visibleOrders.find((o) => o.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  async function handleConvert() {
    if (!selected) return;
    setConverting(true);
    setConvertError(null);
    try {
      const sale = await convertToSale(selected.id);
      setConvertedMessage(`Pedido ${selected.code} convertido — venda ${sale.code} criada.`);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : err && typeof err === "object" && "message" in err && typeof err.message === "string"
            ? err.message
            : "Não foi possível converter o pedido em venda.";
      setConvertError(message);
    } finally {
      setConverting(false);
      setConfirmingConvert(false);
    }
  }

  if (error) {
    return (
      <AppShell navItems={navItems} secondaryText="Pedidos de venda" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{error}</p>
      </AppShell>
    );
  }

  if (!hasPermission("pedidos-venda", "view")) {
    return (
      <AppShell navItems={navItems} secondaryText="Pedidos de venda" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Você não tem permissão para acessar este módulo.</p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Pedidos de venda" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : "Selecione uma filial no menu \"Filiais\" para ver os pedidos."}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Pedidos de venda" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          title="Pedidos de venda"
          columns={COLUNAS}
          rows={visibleOrders}
          getRowId={(order) => order.id}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setConvertError(null);
            setConvertedMessage(null);
          }}
        />

        <RegistryActions
          title="Controles"
          titleVariant="brand"
          search={{ label: "Buscar pedido", value: search, onChange: setSearch }}
          fieldsTitle={selected ? `Pedido ${selected.code}` : loading ? "Carregando..." : undefined}
          fields={
            selected
              ? [
                  { label: "Cliente", value: selected.contactName },
                  { label: "Vendedor", value: selected.sellerName },
                  { label: "Forma de pagamento", value: SALE_PAYMENT_METHOD_LABEL[selected.paymentMethod] },
                  { label: "Parcelas", value: String(selected.installments) },
                  { label: "Total", value: formatOrderTotal(selected.totalAmount) },
                  { label: "Situação", value: SALE_ORDER_STATUS_LABEL[selected.status] },
                  ...(convertError ? [{ label: "Erro", value: convertError }] : []),
                  ...(convertedMessage ? [{ label: "Aviso", value: convertedMessage }] : []),
                ]
              : undefined
          }
          actions={[
            {
              id: "novo-pedido",
              label: "Novo pedido",
              disabled: !canCreate,
              tone: "positive" as const,
              onClick: () => navigate("/pedidos-venda/novo"),
            },
            {
              id: "converter-venda",
              label: "Converter em venda",
              disabled: !selected || selected.status !== "aberto" || !canCreate,
              onClick: () => setConfirmingConvert(true),
            },
            { id: "gerar-nf", label: "Gerar NF", disabled: true },
            {
              id: "pre-visualizar",
              label: "Pré visualizar",
              disabled: !selected,
              onClick: () => selected && setPreviewingId(selected.id),
            },
            { id: "trocar", label: "Trocar", disabled: true },
            { id: "financeiro", label: "Financeiro", disabled: true },
            {
              id: "editar",
              // Mesma condição de "Converter em venda": pedido convertido ou
              // cancelado é dado histórico. A `update_sale_order` recusa do
              // mesmo jeito — esta é a barreira de fora, não a única.
              label: "Editar",
              disabled: !selected || selected.status !== "aberto" || !canEdit,
              onClick: () => selected && navigate(`/pedidos-venda/${selected.id}/editar`),
            },
            { id: "excluir", label: "Excluir", disabled: true, tone: "danger" as const },
          ]}
        />
      </RegistryLayout>

      {previewingId && <SaleOrderPreviewModal saleOrderId={previewingId} onClose={() => setPreviewingId(null)} />}

      {confirmingConvert && selected && (
        <ConfirmDialog
          title="Converter pedido em venda?"
          message={`O pedido ${selected.code} vira uma venda de verdade — é aí que o estoque dos produtos baixa. Esta ação não pode ser desfeita.`}
          confirmLabel={converting ? "Convertendo..." : "Converter"}
          cancelLabel="Cancelar"
          onConfirm={handleConvert}
          onCancel={() => setConfirmingConvert(false)}
        />
      )}
    </AppShell>
  );
}
