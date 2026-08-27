import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryLayout, RegistryTable, type RegistryColumn } from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { normalizeSearchText } from "../../lib/searchText";
import { RefreshIcon } from "../home/icons";
import { extractErrorMessage } from "../sales/useInvoicesData";
import ConditionalResolveModal from "./ConditionalResolveModal";
import { conditionalStatusColor, formatConditionalDate, formatConditionalTotal, type Conditional } from "./conditionals";
import { useConditionalsData } from "./useConditionalsData";

const MODULE_ID = "condicionais";

const COLUNAS: RegistryColumn<Conditional>[] = [
  { key: "code", label: "Código", width: "90px", align: "center", render: (c) => c.code },
  { key: "client", label: "Cliente", width: "minmax(0, 1fr)", primary: true, render: (c) => c.clientName },
  { key: "issueDate", label: "Data de envio", width: "130px", render: (c) => formatConditionalDate(c.issueDate) },
  { key: "dueDate", label: "Prazo de devolução", width: "160px", render: (c) => formatConditionalDate(c.dueDate) },
  {
    key: "status",
    label: "Status",
    width: "170px",
    render: (c) => <span style={{ color: conditionalStatusColor(c.status) }}>{c.status}</span>,
  },
  {
    key: "total",
    label: "Valor total",
    width: "130px",
    align: "right",
    render: (c) => formatConditionalTotal(c.totalAmount),
  },
];

/**
 * Módulo "Condicionais" — peças enviadas para o cliente provar em casa.
 *
 * O estoque já saiu quando a condicional foi criada (`NewConditionalPage`,
 * rota `/condicionais/nova`); esta tela lista o que está em aberto e resolve
 * aos poucos, por item, o que falta decidir: devolver (`ConditionalResolveModal`
 * modo "return") ou converter em venda (mesmo modal, modo "convert"). O
 * status mostrado é sempre calculado — ver `computeConditionalStatus` no
 * repositório.
 */
export default function ConditionalsPage() {
  const navigate = useNavigate();
  const { openWindow, updateWindowPath } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");
  const canCreate = hasPermission(MODULE_ID, "create");

  const { conditionals, loading, error, registerReturn, convertToSale, cancel } =
    useConditionalsData(currentBranchId);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolveMode, setResolveMode] = useState<"return" | "convert" | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  useEffect(() => {
    openWindow({
      id: "condicionais",
      label: "Condicionais",
      path: "/condicionais",
      icon: RefreshIcon,
    });
    // Garante que voltar para a lista pelo dock aponte para cá mesmo quando
    // o formulário "nova" registrou a janela primeiro — ver `NewConditionalPage.tsx`.
    updateWindowPath("condicionais", "/condicionais");
  }, [openWindow, updateWindowPath]);

  useEffect(() => {
    if (selectedId && !conditionals.some((c) => c.id === selectedId)) setSelectedId(null);
  }, [conditionals, selectedId]);

  const visibleConditionals = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    if (!term) return conditionals;
    return conditionals.filter(
      (conditional) =>
        normalizeSearchText(conditional.clientName).includes(term) || normalizeSearchText(conditional.code).includes(term),
    );
  }, [conditionals, search]);

  const selected: Conditional | null = visibleConditionals.find((c) => c.id === selectedId) ?? null;
  // "Cancelar" só cabe quando nada foi resolvido ainda — os únicos status
  // computados que significam isso são "Em aberto" e "Vencida" (o prazo
  // vencido é só um alerta visual, não impede cancelar).
  const canCancelSelected = Boolean(selected && (selected.status === "Em aberto" || selected.status === "Vencida"));

  async function handleCancel() {
    if (!selected) return;
    setCancelling(true);
    try {
      await cancel(selected.id);
      setActionMessage(`Condicional ${selected.code} cancelada — o estoque enviado voltou.`);
      setActionError(null);
    } catch (err) {
      setActionError(extractErrorMessage(err, "Não foi possível cancelar a condicional."));
    } finally {
      setCancelling(false);
      setConfirmingCancel(false);
    }
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Condicionais" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Você não tem permissão para acessar este módulo.</p>
      </AppShell>
    );
  }

  if (error) {
    return (
      <AppShell navItems={navItems} secondaryText="Condicionais" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{error}</p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Condicionais" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : 'Selecione uma filial no menu "Filiais" para ver as condicionais.'}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Condicionais" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          title="Condicionais"
          columns={COLUNAS}
          rows={visibleConditionals}
          getRowId={(conditional) => conditional.id}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setActionError(null);
            setActionMessage(null);
          }}
        />

        <RegistryActions
          title="Controles"
          titleVariant="brand"
          search={{ label: "Buscar Condicional", value: search, onChange: setSearch }}
          fieldsTitle={selected ? `Condicional ${selected.code}` : loading ? "Carregando..." : undefined}
          fields={
            selected
              ? [
                  { label: "Cliente", value: selected.clientName },
                  { label: "Data de envio", value: formatConditionalDate(selected.issueDate) },
                  { label: "Prazo de devolução", value: formatConditionalDate(selected.dueDate) },
                  { label: "Status", value: selected.status },
                  { label: "Valor total", value: formatConditionalTotal(selected.totalAmount) },
                ]
              : []
          }
          actions={[
            {
              id: "nova-condicional",
              label: "Nova condicional",
              disabled: !canCreate,
              tone: "positive" as const,
              onClick: () => navigate("/condicionais/nova"),
            },
            {
              id: "registrar-devolucao",
              label: "Registrar devolução",
              disabled: !selected || !canCreate,
              onClick: () => {
                setActionError(null);
                setActionMessage(null);
                setResolveMode("return");
              },
            },
            {
              id: "converter-venda",
              label: "Converter em venda",
              disabled: !selected || !canCreate,
              onClick: () => {
                setActionError(null);
                setActionMessage(null);
                setResolveMode("convert");
              },
            },
            {
              id: "cancelar",
              label: "Cancelar",
              disabled: !canCancelSelected || !canCreate,
              tone: "danger",
              detached: true,
              onClick: () => setConfirmingCancel(true),
            },
          ]}
        />
      </RegistryLayout>

      {actionError && (
        <div style={{ padding: "0 24px" }}>
          <p style={{ color: "var(--danger)", margin: "4px 0" }}>{actionError}</p>
        </div>
      )}
      {actionMessage && !actionError && (
        <p style={{ color: "var(--positive)", padding: "0 24px" }}>{actionMessage}</p>
      )}

      {resolveMode === "return" && selected && (
        <ConditionalResolveModal
          mode="return"
          conditionalId={selected.id}
          onSubmit={async (input) => {
            await registerReturn({ conditionalId: selected.id, ...input });
            setActionMessage("Devolução registrada — estoque reposto.");
          }}
          onDone={() => setResolveMode(null)}
        />
      )}

      {resolveMode === "convert" && selected && (
        <ConditionalResolveModal
          mode="convert"
          conditionalId={selected.id}
          onSubmit={async (input) => {
            const sale = await convertToSale({ conditionalId: selected.id, ...input });
            setActionMessage(`Convertido em venda — venda ${sale.code} criada.`);
          }}
          onDone={() => setResolveMode(null)}
        />
      )}

      {confirmingCancel && selected && (
        <ConfirmDialog
          title="Cancelar condicional?"
          message={`A condicional ${selected.code} volta com todo o estoque enviado — só possível porque nenhum item foi devolvido ou convertido ainda.`}
          confirmLabel={cancelling ? "Cancelando..." : "Cancelar condicional"}
          cancelLabel="Voltar"
          tone="danger"
          onConfirm={handleCancel}
          onCancel={() => setConfirmingCancel(false)}
        />
      )}
    </AppShell>
  );
}
