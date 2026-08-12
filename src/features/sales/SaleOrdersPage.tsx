import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryTable, type RegistryColumn } from "../../components/registry";
import { SaleOrdersIcon } from "../home/icons";
import { SALE_ORDERS, formatOrderTotal, type SaleOrder } from "./saleOrders";
import "./SaleOrdersPage.css";

const COLUNAS: RegistryColumn<SaleOrder>[] = [
  { key: "code", label: "Codigo", width: "90px", align: "center", render: (o) => o.code },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", render: (o) => o.client },
  { key: "paymentMethod", label: "Forma de pagamento", width: "200px", render: (o) => o.paymentMethod },
  { key: "installments", label: "Parcelas", width: "110px", align: "center", render: (o) => o.installments },
  {
    key: "total",
    label: "Valor total",
    width: "130px",
    align: "center",
    render: (o) => formatOrderTotal(o.total),
  },
];

/** Módulo "Pedidos de venda". */
export default function SaleOrdersPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [search, setSearch] = useState("");
  const [orders] = useState(SALE_ORDERS);
  const [selectedId, setSelectedId] = useState<string | null>(SALE_ORDERS[0]?.id ?? null);

  useEffect(() => {
    openWindow({
      id: "pedidos-venda",
      label: "Pedidos de venda",
      path: "/pedidos-venda",
      icon: SaleOrdersIcon,
    });
  }, [openWindow]);

  const visibleOrders = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter(
      (order) =>
        order.client.toLowerCase().includes(term) || order.code.toLowerCase().includes(term),
    );
  }, [orders, search]);

  const selected: SaleOrder | null = visibleOrders.find((o) => o.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Pedidos de venda" contentTone="blue" fillViewport>
      <div className="sale-orders">
        <RegistryTable
          title="Pedidos de venda"
          columns={COLUNAS}
          rows={visibleOrders}
          getRowId={(order) => order.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryActions
          title="Controles"
          titleVariant="brand"
          search={{ label: "Buscar Venda", value: search, onChange: setSearch }}
          actions={[
            { id: "gerar-nf", label: "Gerar NF", disabled: !selected },
            { id: "pre-visualizar", label: "Pré visualizar", disabled: !selected },
            { id: "trocar", label: "Trocar", disabled: !selected },
            { id: "financeiro", label: "Financeiro", disabled: !selected },
            { id: "editar", label: "Editar", disabled: !selected },
            { id: "excluir", label: "Excluir", disabled: !selected },
          ]}
        />
      </div>
    </AppShell>
  );
}
