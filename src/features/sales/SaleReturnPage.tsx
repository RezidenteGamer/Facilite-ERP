import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { SaleReturnIcon } from "../home/icons";
import { SALE_RETURNS, formatReturnTotal, type SaleReturn } from "./saleReturns";

const COLUNAS: RegistryColumn<SaleReturn>[] = [
  { key: "code", label: "Código", width: "80px", render: (r) => r.code },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", render: (r) => r.client },
  { key: "type", label: "Tipo", width: "110px", align: "center", render: (r) => r.type },
  { key: "paymentMethod", label: "Forma Pagamento", width: "150px", render: (r) => r.paymentMethod },
  { key: "total", label: "Valor total", width: "170px", render: (r) => formatReturnTotal(r.total) },
  { key: "operator", label: "Operador", width: "140px", align: "right", render: (r) => r.operator },
];

/** Módulo "Devolução de venda". */
export default function SaleReturnPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [search, setSearch] = useState("");
  const [returns] = useState(SALE_RETURNS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    openWindow({
      id: "devolucao-venda",
      label: "Devolução de venda",
      path: "/devolucao-venda",
      icon: SaleReturnIcon,
    });
  }, [openWindow]);

  const visibleReturns = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return returns;
    return returns.filter(
      (item) => item.client.toLowerCase().includes(term) || item.code.toLowerCase().includes(term),
    );
  }, [returns, search]);

  const selected: SaleReturn | null = visibleReturns.find((r) => r.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Devolução de venda" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          columns={COLUNAS}
          rows={visibleReturns}
          getRowId={(item) => item.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryActions
          search={{ label: "Buscar Compra", value: search, onChange: setSearch, showLabel: true }}
          fields={[
            { label: "Data venda", value: selected?.saleDate },
            { label: "Data faturamento", value: selected?.billingDate },
            { label: "Número documento", value: selected?.documentNumber },
            { label: "Movimento", value: selected?.movement },
            { label: "Parcelas", value: selected?.installments },
          ]}
          actionsTitle="Opções para vendas"
          actions={[{ id: "devolver-venda", label: "Devolver venda", disabled: !selected }]}
        />
      </RegistryLayout>
    </AppShell>
  );
}
