import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import {
  RegistryActions,
  RegistryLayout,
  RegistryTable,
  type RegistrySummaryItem,
} from "../../components/registry";
import { fetchContactsByKind } from "../../lib/repositories/contactLookups";
import { useAuth } from "../auth/AuthContext";
import type { Contact, ContactKind } from "../customers/contacts";
import { buildDetailFields, buildFormFields, buildTableColumns } from "../registry-engine/moduleView";
import RegistryFormModal from "../registry-engine/RegistryFormModal";
import { useModuleDefinition } from "../registry-engine/useModuleDefinition";
import { FinanceIcon } from "../home/icons";
import FinanceEntryPlanModal from "./FinanceEntryPlanModal";
import {
  buildFinanceEntryEditInput,
  computeCashFlowTotals,
  formatEntryTotal,
  todayIso,
  validateFinanceEntryEditValues,
  type FinanceEntry,
  type FinanceEntryType,
  type FinanceTab,
} from "./finance";
import { extractErrorMessage, useFinancialEntriesData } from "./useFinancialEntriesData";

const MODULE_ID = "financeiro";

/** O contato de um lançamento acompanha o tipo: pago a fornecedor, recebido de cliente. */
const CONTACT_KIND_BY_TYPE: Record<FinanceEntryType, ContactKind> = {
  a_pagar: "fornecedores",
  a_receber: "clientes",
};

/**
 * Módulo "Financeiro" — motor genérico de metadados para listagem/ficha
 * (mesmo padrão de Produtos/Clientes), com criação bespoke (ver
 * `FinanceEntryPlanModal`) e duas RPCs por trás: parcelamento e edição de
 * registro único. "Baixados" não é um terceiro tipo de lançamento: é o
 * recorte de `status = 'baixado'` dos dois tipos juntos.
 */
export default function FinancePage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(MODULE_ID, "view");
  const canCreate = hasPermission(MODULE_ID, "create");
  const canEdit = hasPermission(MODULE_ID, "edit");
  const canDelete = hasPermission(MODULE_ID, "delete");

  const { definition, loading: definitionLoading, error: definitionError } = useModuleDefinition(MODULE_ID);

  const [tab, setTab] = useState<FinanceTab>("a-pagar");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newModalOpen, setNewModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [formContact, setFormContact] = useState<Contact | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const {
    entries,
    error: entriesError,
    createPlan,
    updateEntry,
    settleEntry,
    reopenEntry,
    deleteEntry,
  } = useFinancialEntriesData(currentBranchId);

  useEffect(() => {
    openWindow({ id: "financeiro", label: "Financeiro", path: "/financeiro", icon: FinanceIcon });
  }, [openWindow]);

  const isBaixados = tab === "baixados";

  const visibleEntries = useMemo(() => {
    if (isBaixados) return entries.filter((entry) => entry.status === "baixado");
    const type: FinanceEntryType = tab === "a-pagar" ? "a_pagar" : "a_receber";
    return entries.filter((entry) => entry.status === "aberto" && entry.type === type);
  }, [entries, isBaixados, tab]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && visibleEntries.some((entry) => entry.id === current)) return current;
      return visibleEntries[0]?.id ?? null;
    });
  }, [visibleEntries]);

  const selected: FinanceEntry | null = visibleEntries.find((entry) => entry.id === selectedId) ?? null;

  /** O tipo do lançamento novo vem da aba — "Adicionar" nem aparece em Baixados. */
  const formType: FinanceEntryType = tab === "a-receber" ? "a_receber" : "a_pagar";
  const contactKind = CONTACT_KIND_BY_TYPE[formType];
  const lookupLabel = contactKind === "fornecedores" ? "Fornecedor" : "Cliente";

  const fetchLookupContacts = useCallback(
    (query: string) => fetchContactsByKind(contactKind, query),
    [contactKind],
  );

  const columns = useMemo(() => {
    if (!definition) return [];
    const base = buildTableColumns<FinanceEntry>(definition.fields);
    return base.map((column) => {
      // Valor com sinal e cor: saída (a pagar) em vermelho, entrada (a
      // receber) em verde — dá pra ver a direção do dinheiro num relance,
      // em qualquer aba (inclusive Baixados, onde os dois tipos convivem).
      if (column.key === "total_formatted") {
        return {
          ...column,
          render: (entry: FinanceEntry) => {
            const isOut = entry.type === "a_pagar";
            return (
              <span style={{ color: isOut ? "var(--danger)" : "var(--positive)", fontWeight: 600 }}>
                {isOut ? "−" : "+"} {entry.totalFormatted}
              </span>
            );
          },
        };
      }
      // Vencido/vence hoje: só faz sentido pra quem ainda está em aberto.
      if (column.key === "due_date_formatted") {
        return {
          ...column,
          render: (entry: FinanceEntry) => {
            if (entry.status !== "aberto") return entry.dueDateFormatted;
            const today = todayIso();
            if (entry.dueDate < today) {
              return (
                <span style={{ color: "var(--danger)", fontWeight: 600 }}>
                  {entry.dueDateFormatted} (vencido)
                </span>
              );
            }
            if (entry.dueDate === today) {
              return (
                <span style={{ color: "var(--amber)", fontWeight: 600 }}>{entry.dueDateFormatted} (hoje)</span>
              );
            }
            return entry.dueDateFormatted;
          },
        };
      }
      return column;
    });
  }, [definition]);

  const summary = useMemo((): RegistrySummaryItem[] => {
    if (isBaixados) {
      const { entrou, saiu, saldo } = computeCashFlowTotals(visibleEntries);
      return [
        { label: "Entrou", value: formatEntryTotal(entrou), tone: "positive" },
        { label: "Saiu", value: formatEntryTotal(saiu), tone: "negative" },
        { label: "Saldo", value: formatEntryTotal(saldo), tone: saldo >= 0 ? "positive" : "negative" },
      ];
    }
    const total = visibleEntries.reduce((sum, entry) => sum + entry.total, 0);
    return [
      {
        label: tab === "a-pagar" ? "Total a pagar (aberto)" : "Total a receber (aberto)",
        value: formatEntryTotal(total),
        tone: tab === "a-pagar" ? "negative" : "positive",
      },
    ];
  }, [visibleEntries, isBaixados, tab]);

  const detailFields = useMemo(() => {
    if (!definition) return [];
    // "Data da baixa" só faz sentido na aba Baixados — filtrar a definição
    // (e não o resultado por rótulo) mantém a ficha dirigida por metadados.
    const fields = definition.fields.filter(
      (field) => isBaixados || field.accessorKey !== "settledAtFormatted",
    );
    return buildDetailFields<FinanceEntry>(fields, selected);
  }, [definition, isBaixados, selected]);

  const editFormFields = useMemo(() => (definition ? buildFormFields(definition.fields) : []), [definition]);

  function openNewModal() {
    setFormContact(null);
    setActionError(null);
    setNewModalOpen(true);
  }

  function openEditModal() {
    if (!selected) return;
    setFormContact(
      selected.contactId ? ({ id: selected.contactId, name: selected.contactName } as Contact) : null,
    );
    setActionError(null);
    setEditModalOpen(true);
  }

  /** Toda ação de escrita passa por aqui para a mensagem do banco chegar na tela. */
  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(extractErrorMessage(err, "Não foi possível concluir a operação."));
    }
  }

  async function handleEditSubmit(values: Record<string, string>) {
    if (!selected) return;
    await run(async () => {
      await updateEntry(selected.id, buildFinanceEntryEditInput(values, formContact?.id ?? null));
      setEditModalOpen(false);
    });
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (definitionError || entriesError) {
    return (
      <AppShell navItems={navItems} secondaryText="Financeiro" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>{definitionError ?? entriesError}</p>
      </AppShell>
    );
  }

  if (definitionLoading && !definition) {
    return (
      <AppShell navItems={navItems} secondaryText="Financeiro" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>Carregando módulo...</p>
      </AppShell>
    );
  }

  if (!canView) {
    return (
      <AppShell navItems={navItems} secondaryText="Financeiro" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          Você não tem permissão para acessar este módulo.
        </p>
      </AppShell>
    );
  }

  if (!currentBranchId) {
    return (
      <AppShell navItems={navItems} secondaryText="Financeiro" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          {branches.length === 0
            ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
            : "Selecione uma filial no menu \"Filiais\" para ver o financeiro."}
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Financeiro" contentTone="blue" fillViewport>
      <RegistryLayout variant="table-controls">
        <RegistryTable
          tabs={definition?.tabs.map((moduleTab) => ({ id: moduleTab.id, label: moduleTab.label })) ?? []}
          activeTab={tab}
          onTabChange={(id) => {
            setTab(id as FinanceTab);
            setSelectedId(null);
          }}
          columns={columns}
          rows={visibleEntries}
          getRowId={(entry) => entry.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
          summary={summary}
        />

        <RegistryActions
          title="Controles"
          titleVariant="brand"
          fieldsTitle="Vencimento"
          fields={detailFields}
          actions={[
            ...(isBaixados
              ? []
              : [
                  { id: "adicionar", label: "Adicionar", disabled: !canCreate, onClick: openNewModal },
                  {
                    id: "baixar",
                    label: "Baixar",
                    disabled: !selected || !canEdit,
                    onClick: () => selected && run(() => settleEntry(selected.id)),
                  },
                  {
                    id: "editar",
                    label: "Editar",
                    disabled: !selected || !canEdit || selected.status !== "aberto",
                    onClick: openEditModal,
                  },
                ]),
            // Renegociar e Boletos são de etapas bem mais adiante do plano
            // (cobrança/boleto): ficam desabilitados em vez de sumirem.
            { id: "renegociar", label: "Renegociar", disabled: true },
            { id: "boletos", label: "Boletos", disabled: true },
            ...(isBaixados
              ? [
                  {
                    id: "excluir-baixa",
                    label: "Excluir baixa",
                    disabled: !selected || !canEdit,
                    tone: "danger" as const,
                    onClick: () => selected && run(() => reopenEntry(selected.id)),
                  },
                ]
              : [
                  {
                    id: "excluir",
                    label: "Excluir",
                    disabled: !selected || !canDelete,
                    tone: "danger" as const,
                    onClick: () => selected && setConfirmingDeleteId(selected.id),
                  },
                ]),
          ]}
        />
      </RegistryLayout>

      {actionError && <p style={{ color: "var(--amber)", padding: "0 24px" }}>{actionError}</p>}

      {newModalOpen && (
        <FinanceEntryPlanModal
          type={formType}
          contactLabel={lookupLabel}
          contactKind={contactKind}
          fetchContacts={fetchLookupContacts}
          onSubmit={async (input) => {
            await createPlan(input);
            setNewModalOpen(false);
          }}
          onCancel={() => setNewModalOpen(false)}
        />
      )}

      {editModalOpen && selected && (
        <RegistryFormModal<Contact>
          title="Editar lançamento"
          fields={editFormFields}
          initialValues={{
            paymentMethod: selected.paymentMethod,
            total: String(selected.total),
            document: selected.document,
            dueDate: selected.dueDate,
            issueDate: selected.issueDate,
          }}
          lookupField={{
            label: lookupLabel,
            value: formContact?.name ?? "",
            searchPlaceholder: "Digite o nome ou o documento...",
            fetchItems: fetchLookupContacts,
            getKey: (contact) => contact.id,
            renderItem: (contact) => ({ primary: contact.name, secondary: contact.document }),
            onSelect: setFormContact,
            /* Digitar por cima do contato escolhido desfaz a escolha - o campo
               tem que mostrar o que vai ser gravado. */
            onClear: () => setFormContact(null),
          }}
          validate={validateFinanceEntryEditValues}
          onSubmit={handleEditSubmit}
          onCancel={() => setEditModalOpen(false)}
        />
      )}

      {confirmingDeleteId && (
        <ConfirmDialog
          title="Excluir lançamento?"
          message="Essa ação não pode ser desfeita."
          onConfirm={async () => {
            await run(() => deleteEntry(confirmingDeleteId));
            setConfirmingDeleteId(null);
          }}
          onCancel={() => setConfirmingDeleteId(null)}
        />
      )}
    </AppShell>
  );
}
