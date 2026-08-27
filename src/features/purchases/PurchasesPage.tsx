import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { normalizeSearchText } from "../../lib/searchText";
import { PurchasesIcon } from "../home/icons";
import { SALE_PAYMENT_METHOD_LABEL } from "../sales/sales";
import { PURCHASE_STATUS_LABEL, formatPurchaseTotal, type Purchase } from "./purchases";
import { usePurchasesData } from "./usePurchasesData";

const COLUNAS: RegistryColumn<Purchase>[] = [
  { key: "code", label: "Código", width: "80px", render: (p) => p.code },
  { key: "supplier", label: "Fornecedor", width: "minmax(0, 1fr)", render: (p) => p.contactName },
  { key: "installments", label: "Parcelas", width: "90px", align: "center", render: (p) => p.installmentTotal },
  {
    key: "paymentMethod",
    label: "Forma Pagamento",
    width: "150px",
    render: (p) => SALE_PAYMENT_METHOD_LABEL[p.paymentMethod],
  },
  { key: "total", label: "Valor total", width: "170px", render: (p) => formatPurchaseTotal(p.totalAmount) },
];

/** Módulo "Compras". */
export default function PurchasesPage() {
  const navigate = useNavigate();
  const { openWindow, updateWindowPath } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();
  const { purchases, loading, error } = usePurchasesData(currentBranchId);

  const canCreate = hasPermission("compras", "create");

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    openWindow({
      id: "compras",
      label: "Compras",
      path: "/compras",
      icon: PurchasesIcon,
    });
    // Garante que voltar para a lista pelo dock aponte para cá mesmo quando
    // o formulário "nova" registrou a janela primeiro — ver `PurchaseFormPage.tsx`.
    updateWindowPath("compras", "/compras");
  }, [openWindow, updateWindowPath]);

  useEffect(() => {
    if (selectedId && !purchases.some((p) => p.id === selectedId)) setSelectedId(null);
  }, [purchases, selectedId]);

  const visiblePurchases = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    if (!term) return purchases;
    return purchases.filter(
      (purchase) =>
        normalizeSearchText(purchase.contactName).includes(term) || normalizeSearchText(purchase.code).includes(term),
    );
  }, [purchases, search]);

  const selected: Purchase | null = visiblePurchases.find((p) => p.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (error) {
    return (
      <AppShell navItems={navItems} secondaryText="Compras" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{error}</p>
      </AppShell>
    );
  }

  if (!hasPermission("compras", "view")) {
    return (
      <AppShell navItems={navItems} secondaryText="Compras" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Você não tem permissão para acessar este módulo.</p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Compras" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : "Selecione uma filial no menu \"Filiais\" para ver as compras."}
        </p>
      </AppShell>
    );
  }

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
          fieldsTitle={selected ? `Compra ${selected.code}` : loading ? "Carregando..." : undefined}
          fields={[
            { label: "Fornecedor", value: selected?.contactName },
            { label: "Data emissão", value: selected?.issueDate },
            { label: "Data entrada", value: selected?.entryDate },
            { label: "Número documento", value: selected?.document },
            { label: "Situação", value: selected ? PURCHASE_STATUS_LABEL[selected.status] : undefined },
          ]}
          actionsTitle="Opções para compras"
          actions={[
            {
              id: "nova-compra",
              label: "Nova Compra",
              disabled: !canCreate,
              tone: "positive" as const,
              onClick: () => navigate("/compras/nova"),
            },
            { id: "importar-xml", label: "Importar XML", disabled: true },
            { id: "devolver-compra", label: "Devolver Compra", disabled: true },
            { id: "excluir", label: "Excluir", disabled: true, tone: "danger" as const },
          ]}
        />
      </RegistryLayout>
    </AppShell>
  );
}
