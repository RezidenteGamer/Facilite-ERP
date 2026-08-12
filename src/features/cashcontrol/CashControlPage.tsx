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
  type RegistryTab,
} from "../../components/registry";
import { CashControlIcon } from "../home/icons";
import {
  MANAGERIAL_CASH_ENTRIES,
  OPERATIONAL_CASH_REGISTERS,
  formatCashTotal,
  type ManagerialCashEntry,
  type OperationalCashRegister,
} from "./cashControl";

type CashTab = "operacionais" | "gerencial";

const TABS: RegistryTab[] = [
  { id: "operacionais", label: "Caixas operacionais" },
  { id: "gerencial", label: "Caixa gerencial" },
];

const OPERATIONAL_COLUMNS: RegistryColumn<OperationalCashRegister>[] = [
  { key: "name", label: "Caixa", width: "150px", primary: true, render: (c) => c.name },
  { key: "openedAt", label: "Data de abertura", width: "180px", render: (c) => c.openedAt },
  { key: "closedAt", label: "Data de fechamento", width: "minmax(0, 1fr)", render: (c) => c.closedAt },
  { key: "operator", label: "Operador", width: "160px", align: "right", render: (c) => c.operator },
];

const MANAGERIAL_COLUMNS: RegistryColumn<ManagerialCashEntry>[] = [
  { key: "code", label: "Codigo", width: "70px", render: (c) => c.code },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", render: (c) => c.client },
  { key: "document", label: "Documento", width: "130px", render: (c) => c.document },
  { key: "type", label: "Tipo", width: "90px", render: (c) => c.type },
  { key: "settledAt", label: "Data da baixa", width: "120px", render: (c) => c.settledAt },
  { key: "currency", label: "Moeda", width: "80px", render: (c) => c.currency },
  {
    key: "total",
    label: "Valor total",
    width: "140px",
    align: "right",
    render: (c) => (c.total !== undefined ? formatCashTotal(c.total) : ""),
  },
];

/** Módulo "Controle de caixa". */
export default function CashControlPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [tab, setTab] = useState<CashTab>("operacionais");
  const [operational] = useState(OPERATIONAL_CASH_REGISTERS);
  const [managerial] = useState(MANAGERIAL_CASH_ENTRIES);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    openWindow({
      id: "controle-caixa",
      label: "Controle de caixa",
      path: "/controle-caixa",
      icon: CashControlIcon,
    });
  }, [openWindow]);

  function changeTab(id: string) {
    const next = id as CashTab;
    setTab(next);
    setSelectedId(null);
  }

  const selectedOperational = operational.find((c) => c.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Controle de caixa" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        {tab === "operacionais" ? (
          <RegistryTable
            tabs={TABS}
            activeTab={tab}
            onTabChange={changeTab}
            columns={OPERATIONAL_COLUMNS}
            rows={operational}
            getRowId={(c) => c.id}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        ) : (
          <RegistryTable
            tabs={TABS}
            activeTab={tab}
            onTabChange={changeTab}
            columns={MANAGERIAL_COLUMNS}
            rows={managerial}
            getRowId={(c) => c.id}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        )}

        {tab === "operacionais" ? (
          <RegistryActions
            title="Controles"
            titleVariant="brand"
            actions={[
              { id: "visualizar", label: "Visualizar", disabled: !selectedOperational },
              { id: "abrir-caixa", label: "Abrir caixa" },
              { id: "fechar-caixa", label: "Fechar caixa", disabled: !selectedOperational },
              { id: "transferir", label: "Transferir", disabled: !selectedOperational },
              { id: "manutencao", label: "Manutenção" },
            ]}
          />
        ) : (
          <RegistryActions
            title="Informações"
            titleVariant="brand"
            fields={[
              { label: "Valor total entradas" },
              { label: "Valor total saídas" },
              { label: "Total sangrias" },
              { label: "Suprimentos" },
              { label: "Valor do saldo atual" },
              { label: "Operador" },
            ]}
            actions={[
              { id: "abrir-caixa", label: "Abrir caixa" },
              { id: "fechar-caixa", label: "Fechar caixa" },
              { id: "suprimentos", label: "Suprimentos" },
              { id: "sangria", label: "Sangria" },
              { id: "manutencao", label: "Manutenção" },
            ]}
          />
        )}
      </RegistryLayout>
    </AppShell>
  );
}
