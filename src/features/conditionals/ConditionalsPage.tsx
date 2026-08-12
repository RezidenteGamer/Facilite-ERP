import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { RefreshIcon } from "../home/icons";
import { CONDITIONALS, formatConditionalTotal, type Conditional } from "./conditionals";

const COLUNAS: RegistryColumn<Conditional>[] = [
  { key: "code", label: "Código", width: "90px", align: "center", render: (c) => c.code },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", render: (c) => c.client },
  { key: "sentAt", label: "Data de envio", width: "130px", render: (c) => c.sentAt },
  { key: "dueDate", label: "Prazo de devolução", width: "160px", render: (c) => c.dueDate },
  { key: "status", label: "Status", width: "150px", render: (c) => c.status },
  {
    key: "total",
    label: "Valor total",
    width: "130px",
    align: "right",
    render: (c) => formatConditionalTotal(c.total),
  },
];

/** Módulo "Condicionais" — peças enviadas para o cliente provar em casa. */
export default function ConditionalsPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [search, setSearch] = useState("");
  const [conditionals] = useState(CONDITIONALS);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    openWindow({
      id: "condicionais",
      label: "Condicionais",
      path: "/condicionais",
      icon: RefreshIcon,
    });
  }, [openWindow]);

  const visibleConditionals = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return conditionals;
    return conditionals.filter(
      (conditional) =>
        conditional.client.toLowerCase().includes(term) || conditional.code.toLowerCase().includes(term),
    );
  }, [conditionals, search]);

  const selected: Conditional | null = visibleConditionals.find((c) => c.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Condicionais" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          title="Condicionais"
          columns={COLUNAS}
          rows={visibleConditionals}
          getRowId={(conditional) => conditional.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryActions
          title="Controles"
          titleVariant="brand"
          search={{ label: "Buscar Condicional", value: search, onChange: setSearch }}
          actions={[
            { id: "nova-condicional", label: "Nova condicional" },
            { id: "registrar-devolucao", label: "Registrar devolução", disabled: !selected },
            { id: "converter-venda", label: "Converter em venda", disabled: !selected },
            { id: "cancelar", label: "Cancelar", disabled: !selected, tone: "danger" },
          ]}
        />
      </RegistryLayout>
    </AppShell>
  );
}
