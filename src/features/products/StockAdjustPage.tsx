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
import { StockAdjustIcon } from "../home/icons";
import { STOCK_ADJUSTMENTS, type StockAdjustment } from "./stockAdjustments";

const COLUNAS: RegistryColumn<StockAdjustment>[] = [
  { key: "code", label: "Código", width: "88px", align: "center", render: (a) => a.code },
  { key: "description", label: "Descrição", width: "minmax(0, 1fr)", render: (a) => a.description },
  { key: "change", label: "Alteração", width: "110px", align: "center", render: (a) => a.change },
  { key: "balanceAtDate", label: "Saldo na data", width: "130px", align: "center", render: (a) => a.balanceAtDate },
];

/** Módulo "Ajuste de estoque". */
export default function StockAdjustPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [search, setSearch] = useState("");
  const [adjustments] = useState(STOCK_ADJUSTMENTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
        adjustment.description.toLowerCase().includes(term) ||
        adjustment.code.toLowerCase().includes(term),
    );
  }, [adjustments, search]);

  const selected: StockAdjustment | null = visibleAdjustments.find((a) => a.id === selectedId) ?? null;

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
            { id: "ajuste", label: "Ajuste de estoque" },
            { id: "excluir", label: "Excluir", disabled: !selected },
          ]}
        />

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
            { label: "Ultima alteração", value: selected?.lastChange },
            { label: "Tipo", value: selected?.type },
            { label: "Preço custo", value: selected?.costPrice },
            { label: "Data alteração", value: selected?.changeDate },
            { label: "Local", value: selected?.location },
            { label: "Sub-local", value: selected?.subLocation },
            { label: "Data de cadastro", value: selected?.createdAt },
            { label: "Operador", value: selected?.operator },
            { label: "Estoque atual", value: selected?.currentStock },
          ]}
          media={{ label: "Imagem", layout: "inline" }}
        />
      </RegistryLayout>
    </AppShell>
  );
}
