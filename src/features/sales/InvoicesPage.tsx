import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { InvoicesIcon } from "../home/icons";
import { INVOICES, formatInvoiceTotal, type Invoice } from "./invoices";

const COLUNAS: RegistryColumn<Invoice>[] = [
  { key: "code", label: "Codigo", width: "90px", align: "center", render: (n) => n.code },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", render: (n) => n.client },
  { key: "model", label: "Modelo", width: "100px", align: "center", render: (n) => n.model },
  { key: "paymentMethod", label: "Forma de pagamento", width: "200px", render: (n) => n.paymentMethod },
  { key: "installments", label: "Parcelas", width: "110px", align: "center", render: (n) => n.installments },
  {
    key: "total",
    label: "Valor total",
    width: "130px",
    align: "center",
    render: (n) => formatInvoiceTotal(n.total),
  },
];

/** Módulo "Notas emitidas". */
export default function InvoicesPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();

  const [invoices] = useState(INVOICES);
  const [selectedId, setSelectedId] = useState<string | null>(INVOICES[0]?.id ?? null);

  useEffect(() => {
    openWindow({
      id: "notas-emitidas",
      label: "Notas emitidas",
      path: "/notas-emitidas",
      icon: InvoicesIcon,
    });
  }, [openWindow]);

  const selected: Invoice | null = invoices.find((n) => n.id === selectedId) ?? null;

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText="Notas fiscais emitidas" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          title="Notas emitidas"
          columns={COLUNAS}
          rows={invoices}
          getRowId={(invoice) => invoice.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryActions
          title="Controles"
          titleVariant="brand"
          actions={[
            { id: "visualizar", label: "Visualizar", disabled: !selected },
            { id: "gerar-xml", label: "Gerar XML", disabled: !selected },
            { id: "carta-de-correcao", label: "Carta de correção", disabled: !selected },
            { id: "financeiro", label: "Financeiro", disabled: !selected },
            { id: "trocar", label: "Trocar", disabled: !selected },
            { id: "cancelar", label: "Cancelar", disabled: !selected, tone: "danger" },
          ]}
        />
      </RegistryLayout>
    </AppShell>
  );
}
