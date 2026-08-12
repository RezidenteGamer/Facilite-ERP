import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import {
  RegistryActions,
  RegistryLayout,
  RegistryTable,
  type RegistryColumn,
} from "../../components/registry";
import { FinanceIcon } from "../home/icons";
import { FINANCE_ENTRIES, formatEntryTotal, type FinanceEntry, type FinanceKind } from "./finance";

const COLUNAS: RegistryColumn<FinanceEntry>[] = [
  { key: "code", label: "Codigo", width: "90px", align: "center", render: (e) => e.code },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", render: (e) => e.client },
  { key: "paymentMethod", label: "Forma de pagamento", width: "190px", render: (e) => e.paymentMethod },
  { key: "installment", label: "Parcela", width: "90px", align: "center", render: (e) => e.installment },
  {
    key: "total",
    label: "Valor total",
    width: "130px",
    align: "right",
    render: (e) => formatEntryTotal(e.total),
  },
];

/** Módulo "Financeiro". */
export default function FinancePage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [kind, setKind] = useState<FinanceKind>("a-pagar");
  const [entries] = useState(FINANCE_ENTRIES);
  const [selectedId, setSelectedId] = useState<string | null>(FINANCE_ENTRIES["a-pagar"][0]?.id ?? null);

  useEffect(() => {
    openWindow({
      id: "financeiro",
      label: "Financeiro",
      path: "/financeiro",
      icon: FinanceIcon,
    });
  }, [openWindow]);

  const visibleEntries = entries[kind];
  const selected: FinanceEntry | null = visibleEntries.find((e) => e.id === selectedId) ?? null;
  const isBaixados = kind === "baixados";

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Financeiro" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          tabs={[
            { id: "a-pagar", label: "A pagar" },
            { id: "a-receber", label: "A receber" },
            { id: "baixados", label: "Baixados" },
          ]}
          activeTab={kind}
          onTabChange={(id) => {
            const next = id as FinanceKind;
            setKind(next);
            setSelectedId(entries[next][0]?.id ?? null);
          }}
          columns={COLUNAS}
          rows={visibleEntries}
          getRowId={(entry) => entry.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryActions
          title="Controles"
          titleVariant="brand"
          fieldsTitle="Vencimento"
          fields={[
            { label: "Documento", value: selected?.document },
            { label: "Vencimento", value: selected?.dueDate },
            { label: "Emissão", value: selected?.issueDate },
            { label: "Alteração", value: selected?.changedAt },
            { label: "Operador", value: selected?.operator },
            ...(isBaixados ? [{ label: "Data da baixa", value: selected?.settledAt }] : []),
          ]}
          actions={[
            ...(isBaixados
              ? []
              : [
                  { id: "adicionar", label: "Adicionar" },
                  { id: "baixar", label: "Baixar", disabled: !selected },
                ]),
            { id: "renegociar", label: "Renegociar", disabled: !selected },
            { id: "boletos", label: "Boletos", disabled: !selected },
            {
              id: isBaixados ? "excluir-baixa" : "excluir",
              label: isBaixados ? "Excluir baixa" : "Excluir",
              disabled: !selected,
              tone: "danger" as const,
            },
          ]}
        />
      </RegistryLayout>
    </AppShell>
  );
}
