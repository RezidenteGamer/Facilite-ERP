import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { PurchasesIcon } from "../home/icons";
import { PURCHASES, formatPurchaseTotal, type Purchase } from "./purchases";

const COLUNAS: RegistryColumn<Purchase>[] = [
  { key: "code", label: "Código", width: "80px", render: (p) => p.code },
  { key: "supplier", label: "Fornecedor", width: "minmax(0, 1fr)", render: (p) => p.supplier },
  { key: "installments", label: "Parcelas", width: "90px", align: "center", render: (p) => p.installments },
  { key: "paymentMethod", label: "Forma Pagamento", width: "150px", render: (p) => p.paymentMethod },
  { key: "total", label: "Valor total", width: "170px", render: (p) => formatPurchaseTotal(p.total) },
  { key: "operator", label: "Operador", width: "140px", align: "right", render: (p) => p.operator },
];

/** Módulo "Compras". */
export default function PurchasesPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [search, setSearch] = useState("");
  const [purchases] = useState(PURCHASES);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    openWindow({
      id: "compras",
      label: "Compras",
      path: "/compras",
      icon: PurchasesIcon,
    });
  }, [openWindow]);

  const visiblePurchases = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return purchases;
    return purchases.filter(
      (purchase) =>
        purchase.supplier.toLowerCase().includes(term) || purchase.code.toLowerCase().includes(term),
    );
  }, [purchases, search]);

  const selected: Purchase | null = visiblePurchases.find((p) => p.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Compras" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          columns={COLUNAS}
          rows={visiblePurchases}
          getRowId={(purchase) => purchase.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryActions
          search={{ label: "Buscar Compra", value: search, onChange: setSearch, showLabel: true }}
          fields={[
            { label: "Data compra", value: selected?.purchaseDate },
            { label: "Data faturamento", value: selected?.billingDate },
            { label: "Número documento", value: selected?.documentNumber },
            { label: "Movimento", value: selected?.movement },
          ]}
          actionsTitle="Opções para compras"
          actions={[
            { id: "nova-compra", label: "Nova Compra" },
            { id: "importar-xml", label: "Importar XML" },
            { id: "devolver-compra", label: "Devolver Compra", disabled: !selected },
            { id: "excluir", label: "Excluir", disabled: !selected },
          ]}
        />
      </RegistryLayout>
    </AppShell>
  );
}
