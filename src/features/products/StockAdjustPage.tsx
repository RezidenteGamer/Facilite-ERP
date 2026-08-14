import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import {
  RegistryActions,
  RegistryDetails,
  RegistryLayout,
  RegistryTable,
  type RegistryColumn,
} from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { StockAdjustIcon } from "../home/icons";
import { formatPrice } from "./products";
import StockAdjustModal from "./StockAdjustModal";
import { useStockAdjustmentsData } from "./useStockAdjustmentsData";
import type { StockAdjustment } from "../../lib/repositories/stockAdjustmentsRepository";

const COLUNAS: RegistryColumn<StockAdjustment>[] = [
  { key: "code", label: "Código", width: "88px", align: "center", render: (a) => a.productCode },
  { key: "description", label: "Descrição", width: "minmax(0, 1fr)", render: (a) => a.productDescription },
  { key: "change", label: "Alteração", width: "110px", align: "center", render: (a) => (a.change > 0 ? `+${a.change}` : String(a.change)) },
  { key: "balanceAtDate", label: "Saldo na data", width: "130px", align: "center", render: (a) => String(a.balanceAfter) },
];

function formatDateTime(value?: string) {
  if (!value) return undefined;
  return new Date(value).toLocaleString("pt-BR");
}

/** Módulo "Ajuste de estoque": auditoria (criar + listar, sem editar/excluir) das alterações manuais em `products.stock`. */
export default function StockAdjustPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId } = useAuth();
  const { adjustments, loading, error, createAdjustment } = useStockAdjustmentsData(currentBranchId);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const canCreate = hasPermission("ajuste-estoque", "create");

  useEffect(() => {
    openWindow({
      id: "ajuste-estoque",
      label: "Ajuste de estoque",
      path: "/ajuste-estoque",
      icon: StockAdjustIcon,
    });
  }, [openWindow]);

  const visibleAdjustments = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return adjustments;
    return adjustments.filter(
      (adjustment) =>
        adjustment.productDescription.toLowerCase().includes(term) ||
        adjustment.productCode.toLowerCase().includes(term),
    );
  }, [adjustments, search]);

  const selected: StockAdjustment | null = visibleAdjustments.find((a) => a.id === selectedId) ?? null;

  async function handleSubmit(input: { productId: string; change: number; reason: string }) {
    await createAdjustment(input);
    setModalOpen(false);
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Ajuste de estoque" contentTone="blue" fillViewport>
      <RegistryLayout>
        <RegistryActions
          title="Ajuste de estoque"
          actions={[
            { id: "ajuste", label: "Ajuste de estoque", disabled: !canCreate, onClick: () => setModalOpen(true) },
          ]}
        />

        {error && <p role="alert">{error}</p>}

        <RegistryTable
          columns={COLUNAS}
          rows={visibleAdjustments}
          getRowId={(adjustment) => adjustment.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryDetails
          searchLabel="Buscar produto"
          search={search}
          onSearchChange={setSearch}
          fields={[
            { label: "Ultima alteração", value: formatDateTime(selected?.createdAt) },
            { label: "Tipo", value: selected?.reason },
            { label: "Preço custo", value: selected?.productCostPrice !== undefined ? formatPrice(selected.productCostPrice) : undefined },
            { label: "Data alteração", value: formatDateTime(selected?.createdAt) },
            { label: "Local", value: selected?.productLocation },
            { label: "Sub-local", value: selected?.productSubLocation },
            { label: "Operador", value: selected?.operatorName },
            { label: "Estoque atual", value: selected ? String(selected.productCurrentStock) : undefined },
          ]}
          media={{ label: "Imagem", layout: "inline" }}
        />
      </RegistryLayout>

      {loading && <p aria-hidden="true" style={{ display: "none" }}>Carregando…</p>}

      {modalOpen && (
        <StockAdjustModal branchId={currentBranchId} onSubmit={handleSubmit} onCancel={() => setModalOpen(false)} />
      )}
    </AppShell>
  );
}
