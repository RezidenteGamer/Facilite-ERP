import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import {
  RegistryActions,
  RegistryLayout,
  RegistryTable,
  type RegistryColumn,
  type RegistrySummaryItem,
  type RegistryTab,
} from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { CashControlIcon } from "../home/icons";
import CashMovementModal from "./CashMovementModal";
import {
  CASH_SESSION_STATUS_LABEL,
  formatCashTotal,
  type CashLedgerEntry,
  type CashMovementType,
  type CashSession,
} from "./cashControl";
import CloseCashSessionModal from "./CloseCashSessionModal";
import OpenCashSessionModal from "./OpenCashSessionModal";
import { useCashControlData, useCashSessionLedger } from "./useCashControlData";

const MODULE_ID = "controle-caixa";

type CashTab = "operacionais" | "gerencial";

const TABS: RegistryTab[] = [
  { id: "operacionais", label: "Caixas operacionais" },
  { id: "gerencial", label: "Caixa gerencial" },
];

const OPERATIONAL_COLUMNS: RegistryColumn<CashSession>[] = [
  { key: "code", label: "Código", width: "80px", render: (s) => s.code },
  { key: "registerName", label: "Caixa", width: "130px", primary: true, render: (s) => s.registerName },
  {
    key: "status",
    label: "Situação",
    width: "100px",
    render: (s) => (
      <span style={{ color: s.status === "aberto" ? "var(--positive)" : undefined, fontWeight: 600 }}>
        {CASH_SESSION_STATUS_LABEL[s.status]}
      </span>
    ),
  },
  { key: "openedAt", label: "Data de abertura", width: "170px", render: (s) => s.openedAtFormatted },
  { key: "closedAt", label: "Data de fechamento", width: "minmax(0, 1fr)", render: (s) => s.closedAtFormatted },
  { key: "operator", label: "Operador", width: "150px", align: "right", render: (s) => s.openedByName },
];

const LEDGER_COLUMNS: RegistryColumn<CashLedgerEntry>[] = [
  { key: "label", label: "Tipo", width: "110px", render: (e) => e.label },
  { key: "description", label: "Descrição", width: "minmax(0, 1fr)", primary: true, render: (e) => e.description },
  { key: "createdAt", label: "Data", width: "170px", render: (e) => e.createdAtFormatted },
  {
    key: "amount",
    label: "Valor",
    width: "150px",
    align: "right",
    render: (e) => {
      const isOut = e.kind === "sangria";
      return (
        <span style={{ color: isOut ? "var(--danger)" : "var(--positive)", fontWeight: 600 }}>
          {isOut ? "−" : "+"} {e.amountFormatted}
        </span>
      );
    },
  },
];

/**
 * Módulo "Controle de caixa": sessão de caixa (abrir/fechar) e movimentação
 * manual (sangria/suprimento) — vincular uma venda a uma sessão é etapa 6
 * (Ponto de Venda), fora de escopo aqui. "Caixa gerencial" lê vendas em
 * dinheiro por uma consulta (nunca grava vínculo) — ver AGENTS.md.
 */
export default function CashControlPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");
  const canCreate = hasPermission(MODULE_ID, "create");
  const canEdit = hasPermission(MODULE_ID, "edit");

  const { registers, sessions, loading, error, openSession, closeSession, addMovement } =
    useCashControlData(currentBranchId);

  const [tab, setTab] = useState<CashTab>("operacionais");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [ledgerSelectedId, setLedgerSelectedId] = useState<string | null>(null);
  const [openModalOpen, setOpenModalOpen] = useState(false);
  const [closingSession, setClosingSession] = useState<CashSession | null>(null);
  const [movementType, setMovementType] = useState<CashMovementType | null>(null);

  useEffect(() => {
    openWindow({ id: "controle-caixa", label: "Controle de caixa", path: "/controle-caixa", icon: CashControlIcon });
  }, [openWindow]);

  useEffect(() => {
    if (selectedSessionId && !sessions.some((s) => s.id === selectedSessionId)) setSelectedSessionId(null);
  }, [sessions, selectedSessionId]);

  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;
  const openSessionInBranch = sessions.find((s) => s.status === "aberto") ?? null;
  // Aba "Caixa gerencial": a sessão selecionada em "Caixas operacionais",
  // ou a sessão aberta atual se nada foi selecionado (ver AGENTS.md).
  const gerencialSession = selectedSession ?? openSessionInBranch;

  const { entries: ledgerEntries, reload: reloadLedger } = useCashSessionLedger(gerencialSession?.id ?? null);

  const gerencialSummary = useMemo((): RegistrySummaryItem[] => {
    if (!gerencialSession) return [];
    const entradasVenda = ledgerEntries.filter((e) => e.kind === "venda").reduce((sum, e) => sum + e.amount, 0);
    const suprimentos = ledgerEntries.filter((e) => e.kind === "suprimento").reduce((sum, e) => sum + e.amount, 0);
    const sangrias = ledgerEntries.filter((e) => e.kind === "sangria").reduce((sum, e) => sum + e.amount, 0);
    const entradas = entradasVenda + suprimentos;
    const saldoAtual = gerencialSession.openingAmount + entradas - sangrias;
    return [
      { label: "Valor total entradas", value: formatCashTotal(entradas), tone: "positive" },
      { label: "Valor total saídas", value: formatCashTotal(sangrias), tone: "negative" },
      { label: "Total sangrias", value: formatCashTotal(sangrias), tone: "negative" },
      { label: "Suprimentos", value: formatCashTotal(suprimentos), tone: "positive" },
      { label: "Valor do saldo atual", value: formatCashTotal(saldoAtual), tone: saldoAtual >= 0 ? "positive" : "negative" },
    ];
  }, [gerencialSession, ledgerEntries]);

  function changeTab(id: string) {
    setTab(id as CashTab);
  }

  function openCloseModalFor(session: CashSession | null) {
    if (!session) return;
    setClosingSession(session);
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (error) {
    return (
      <AppShell navItems={navItems} secondaryText="Controle de caixa" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{error}</p>
      </AppShell>
    );
  }

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Controle de caixa" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Você não tem permissão para acessar este módulo.</p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Controle de caixa" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : "Selecione uma filial no menu \"Filiais\" para ver o controle de caixa."}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Controle de caixa" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        {tab === "operacionais" ? (
          <RegistryTable
            tabs={TABS}
            activeTab={tab}
            onTabChange={changeTab}
            columns={OPERATIONAL_COLUMNS}
            rows={sessions}
            getRowId={(s) => s.id}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
          />
        ) : (
          <RegistryTable
            tabs={TABS}
            activeTab={tab}
            onTabChange={changeTab}
            columns={LEDGER_COLUMNS}
            rows={ledgerEntries}
            getRowId={(e) => e.id}
            selectedId={ledgerSelectedId}
            onSelect={setLedgerSelectedId}
            summary={gerencialSummary}
          />
        )}

        {tab === "operacionais" ? (
          <RegistryActions
            title="Controles"
            titleVariant="brand"
            fieldsTitle={selectedSession ? `Caixa ${selectedSession.code}` : loading ? "Carregando..." : undefined}
            fields={[
              { label: "Caixa", value: selectedSession?.registerName },
              { label: "Situação", value: selectedSession ? CASH_SESSION_STATUS_LABEL[selectedSession.status] : undefined },
              { label: "Aberto por", value: selectedSession?.openedByName },
              { label: "Data abertura", value: selectedSession?.openedAtFormatted },
              { label: "Valor abertura", value: selectedSession?.openingAmountFormatted },
              { label: "Fechado por", value: selectedSession?.closedByName },
              { label: "Data fechamento", value: selectedSession?.closedAtFormatted },
              { label: "Valor contado", value: selectedSession?.countedAmountFormatted },
              { label: "Valor esperado", value: selectedSession?.expectedAmountFormatted },
              { label: "Diferença", value: selectedSession?.differenceFormatted },
            ]}
            actions={[
              {
                id: "abrir-caixa",
                label: "Abrir caixa",
                disabled: !canCreate || !!openSessionInBranch,
                onClick: () => setOpenModalOpen(true),
              },
              {
                id: "fechar-caixa",
                label: "Fechar caixa",
                disabled: !selectedSession || selectedSession.status !== "aberto" || !canEdit,
                onClick: () => openCloseModalFor(selectedSession),
              },
              { id: "transferir", label: "Transferir", disabled: true },
              { id: "manutencao", label: "Manutenção", disabled: true },
            ]}
          />
        ) : (
          <RegistryActions
            title="Informações"
            titleVariant="brand"
            fieldsTitle={gerencialSession ? `Caixa ${gerencialSession.code}` : undefined}
            fields={[
              { label: "Caixa", value: gerencialSession?.registerName },
              { label: "Situação", value: gerencialSession ? CASH_SESSION_STATUS_LABEL[gerencialSession.status] : undefined },
              { label: "Operador", value: gerencialSession?.openedByName },
            ]}
            actions={[
              {
                id: "abrir-caixa",
                label: "Abrir caixa",
                disabled: !canCreate || !!openSessionInBranch,
                onClick: () => setOpenModalOpen(true),
              },
              {
                id: "fechar-caixa",
                label: "Fechar caixa",
                disabled: !gerencialSession || gerencialSession.status !== "aberto" || !canEdit,
                onClick: () => openCloseModalFor(gerencialSession),
              },
              {
                id: "suprimentos",
                label: "Suprimentos",
                disabled: !gerencialSession || gerencialSession.status !== "aberto" || !canCreate,
                onClick: () => setMovementType("suprimento"),
              },
              {
                id: "sangria",
                label: "Sangria",
                disabled: !gerencialSession || gerencialSession.status !== "aberto" || !canCreate,
                onClick: () => setMovementType("sangria"),
              },
              { id: "manutencao", label: "Manutenção", disabled: true },
            ]}
          />
        )}
      </RegistryLayout>

      {openModalOpen && (
        <OpenCashSessionModal
          registers={registers}
          onSubmit={async (input) => {
            await openSession(input);
            setOpenModalOpen(false);
          }}
          onCancel={() => setOpenModalOpen(false)}
        />
      )}

      {closingSession && (
        <CloseCashSessionModal
          session={closingSession}
          onSubmit={(input) => closeSession({ sessionId: closingSession.id, countedAmount: input.countedAmount })}
          onDone={() => {
            setClosingSession(null);
            reloadLedger();
          }}
        />
      )}

      {movementType && gerencialSession && (
        <CashMovementModal
          type={movementType}
          onSubmit={async (input) => {
            await addMovement({
              sessionId: gerencialSession.id,
              type: movementType,
              amount: input.amount,
              description: input.description,
            });
            await reloadLedger();
            setMovementType(null);
          }}
          onCancel={() => setMovementType(null)}
        />
      )}
    </AppShell>
  );
}
