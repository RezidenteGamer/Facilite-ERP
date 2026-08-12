import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { TaxIcon } from "../home/icons";
import { TAXATIONS, type Taxation } from "./taxations";

const COLUNAS: RegistryColumn<Taxation>[] = [
  { key: "code", label: "Código", width: "100px", align: "left", render: (t) => t.code },
  { key: "name", label: "Nome", width: "minmax(0, 1fr)", render: (t) => t.name },
  { key: "createdAt", label: "Data de criação", width: "170px", align: "left", render: (t) => t.createdAt },
];

/** Módulo "Tributações". */
export default function TaxationsPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [taxations] = useState(TAXATIONS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    openWindow({
      id: "tributacoes",
      label: "Tributações",
      path: "/tributacoes",
      icon: TaxIcon,
    });
  }, [openWindow]);

  const selected = taxations.find((t) => t.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Tributações" contentTone="blue" fillViewport>
      <RegistryLayout variant="single">
        <RegistryTable
          title="Tributações cadastradas"
          titleVariant="plain"
          columns={COLUNAS}
          rows={taxations}
          getRowId={(taxation) => taxation.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
          minRows={0}
          footerActions={[
            { id: "criar", label: "Criar nova tributação" },
            { id: "editar", label: "Editar", disabled: !selected },
            { id: "excluir", label: "Excluir", disabled: !selected },
          ]}
        />
      </RegistryLayout>
    </AppShell>
  );
}
