import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { RegistryActions, RegistryDetails, RegistryLayout, RegistryTable } from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { buildDetailFields, buildFormFields, buildTableColumns } from "../registry-engine/moduleView";
import RegistryFormModal from "../registry-engine/RegistryFormModal";
import { useModuleDefinition } from "../registry-engine/useModuleDefinition";
import { STATUS_KEY, type GenericRow } from "../../lib/repositories/genericModuleRepository";
import { normalizeSearchText } from "../../lib/searchText";
import type { CatalogModule } from "./catalog";
import { extractErrorMessage, useGenericModuleData } from "./useGenericModuleData";
import { useModuleReferences } from "./useModuleReferences";
import { useModuleWorkflow } from "./useModuleWorkflow";

type ModalState = "none" | "new" | "edit";

/**
 * Tela de um módulo que **não tem componente próprio** — o fallback do
 * roteador quando o id do módulo não está em `MODULE_COMPONENTS`.
 *
 * Ela não sabe nada sobre o módulo que está exibindo: rótulo, colunas da
 * lista, campos da ficha e campos do formulário saem todos de
 * `useModuleDefinition(moduleId)` + `module_fields`, e os dados saem da tabela
 * que `modules.data_table` aponta. É exatamente o que Produtos e Clientes já
 * fazem — só que sem um arquivo próprio por módulo.
 *
 * É esta tela que torna M3 possível: um módulo criado pelo usuário nunca vai
 * ter componente registrado no código, e precisa funcionar mesmo assim.
 */
export default function GenericModulePage({ module }: { module: CatalogModule }) {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { hasPermission, currentBranchId, branches } = useAuth();

  const canView = hasPermission(module.id, "view");
  const canCreate = hasPermission(module.id, "create");
  const canEdit = hasPermission(module.id, "edit");
  const canDelete = hasPermission(module.id, "delete");

  const { definition, error: definitionError } = useModuleDefinition(module.id);

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>("none");
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fields = useMemo(() => definition?.fields ?? [], [definition]);

  const {
    rows,
    error: dataError,
    reload,
    createRow,
    updateRow,
    removeRow,
  } = useGenericModuleData({
    moduleId: module.id,
    storageKind: module.storageKind,
    table: definition?.dataTable ?? null,
    fields,
    branchId: currentBranchId,
    branchScoped: module.branchScoped,
    enabled: canView && (module.storageKind === "generic" || Boolean(definition?.dataTable)),
  });

  /* Workflow só existe no armazenamento genérico: um módulo `table` guarda o
     dado numa tabela dedicada, que não tem coluna `status`. Campos de
     referência não têm essa restrição — `useModuleReferences` resolve tanto
     `generic` (module_records) quanto `table` (a tabela dedicada), então um
     módulo `table` como Tributações também pode referenciar outro `table`
     como os catálogos de UF/CFOP/etc. (ver `module_fields_guard_reference`). */
  const isGeneric = module.storageKind === "generic";
  const workflow = useModuleWorkflow(module.id, canView && isGeneric);
  const references = useModuleReferences(fields, canView);

  useEffect(() => {
    if (!module.path) return;
    openWindow({ id: module.id, label: module.label, path: module.path });
  }, [openWindow, module.id, module.label, module.path]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && rows.some((row) => row.id === current)) return current;
      return rows[0]?.id ?? null;
    });
  }, [rows]);

  /* Busca genérica: varre os valores que a própria lista mostra, já que não
     existe "campo de busca" declarado nos metadados. */
  const visibleRows = useMemo(() => {
    const term = normalizeSearchText(search.trim());
    if (!term) return rows;
    const searchable = fields.filter((field) => field.showInTable);
    return rows.filter((row) =>
      searchable.some((field) => normalizeSearchText(String(row[field.accessorKey] ?? "")).includes(term)),
    );
  }, [rows, search, fields]);

  const selected: GenericRow | null = visibleRows.find((row) => row.id === selectedId) ?? null;

  const columns = useMemo(
    () => buildTableColumns<GenericRow>(fields, references.labels),
    [fields, references.labels],
  );

  /* A situação entra como o primeiro item da ficha, antes dos campos do
     módulo: é o estado do registro, não mais um dado dele. */
  const detailFields = useMemo(() => {
    const base = buildDetailFields<GenericRow>(fields, selected, references.labels);
    if (!workflow.hasWorkflow) return base;
    return [
      {
        label: "Situação",
        value: selected
          ? (workflow.labelForStatus(selected[STATUS_KEY] as string | null) ?? "")
          : undefined,
      },
      ...base,
    ];
  }, [fields, selected, references.labels, workflow]);

  const formFields = useMemo(() => buildFormFields(fields), [fields]);

  /**
   * Botões de transição a partir da situação do registro selecionado.
   *
   * O que está por trás de cada botão é invisível aqui de propósito: quem usa
   * o módulo vê "Marcar como resolvido" e mais nada — que aquela transição
   * também escreva noutro módulo é assunto de quem a configurou.
   */
  const transitionActions = useMemo(() => {
    if (!workflow.hasWorkflow || !selected) return [];
    return workflow
      .transitionsFrom(selected[STATUS_KEY] as string | null)
      .map((transition) => ({
        id: `transicao-${transition.id}`,
        label: transition.label,
        disabled: !canEdit,
        onClick: () =>
          run(async () => {
            await workflow.run(selected.id, transition.toSituationId);
            await reload();
          }),
      }));
  }, [workflow, selected, canEdit, reload]);

  const editInitialValues = useMemo(() => {
    if (!selected) return undefined;
    const values: Record<string, string> = {};
    for (const field of formFields) {
      const value = selected[field.accessorKey];
      values[field.accessorKey] = value === null || value === undefined ? "" : String(value);
    }
    return values;
  }, [selected, formFields]);

  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(extractErrorMessage(err, "Não foi possível concluir a operação."));
    }
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  const title = definition?.label ?? module.label;

  function shell(children: ReactNode) {
    return (
      <AppShell navItems={navItems} secondaryText={title} contentTone="blue" fillViewport>
        {children}
      </AppShell>
    );
  }

  function message(text: string) {
    return shell(<p style={{ color: "var(--white)", padding: 24 }}>{text}</p>);
  }

  if (definitionError || dataError) return message(definitionError ?? dataError ?? "");
  if (!definition) return message("Carregando módulo...");
  if (!canView) return message("Você não tem permissão para acessar este módulo.");

  /* Um módulo `table` sem `data_table` é uma entrada de navegação sem dados
     próprios (tela mock, tela administrativa). Sem componente e sem tabela
     não há o que montar — dizer isso é melhor que uma tela vazia. Módulos
     `generic` nunca caem aqui: o dado deles é resolvido pelo `module_id`
     em `module_records`, não por um nome de tabela. */
  if (module.storageKind === "table" && !definition.dataTable) {
    return message(
      "Este módulo ainda não tem tabela de dados configurada (modules.data_table).",
    );
  }

  if (module.branchScoped && !currentBranchId) {
    return message(
      branches.length === 0
        ? "Você ainda não tem acesso a nenhuma filial. Fale com um administrador."
        : "Selecione uma filial no menu Filiais para ver os registros.",
    );
  }

  return shell(
    <>
      {actionError && <p style={{ color: "var(--danger)", padding: "12px 24px 0" }}>{actionError}</p>}

      <RegistryLayout>
        <RegistryActions
          title={`Cadastrar um novo registro em ${title}`}
          actions={[
            {
              id: "novo",
              label: "Novo",
              disabled: !canCreate,
              tone: "positive" as const,
              onClick: () => setModal("new"),
            },
            {
              id: "editar",
              label: "Editar",
              disabled: !selected || !canEdit,
              onClick: () => setModal("edit"),
            },
            ...transitionActions,
            {
              id: "excluir",
              label: "Excluir",
              disabled: !selected || !canDelete,
              detached: true,
              tone: "danger" as const,
              onClick: () => selected && setConfirmingDeleteId(selected.id),
            },
          ]}
        />

        <RegistryTable
          columns={columns}
          rows={visibleRows}
          getRowId={(row) => row.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryDetails
          searchLabel="Buscar"
          search={search}
          onSearchChange={setSearch}
          fields={detailFields}
        />
      </RegistryLayout>

      {modal === "new" && (
        <RegistryFormModal
          title={`Novo registro — ${title}`}
          fields={formFields}
          referenceOptions={references.options}
          onSubmit={(values) =>
            run(async () => {
              await createRow(values);
              setModal("none");
            })
          }
          onCancel={() => setModal("none")}
        />
      )}

      {modal === "edit" && selected && (
        <RegistryFormModal
          title={`Editar registro — ${title}`}
          fields={formFields}
          initialValues={editInitialValues}
          referenceOptions={references.options}
          onSubmit={(values) =>
            run(async () => {
              await updateRow(selected.id, values);
              setModal("none");
            })
          }
          onCancel={() => setModal("none")}
        />
      )}

      {confirmingDeleteId && (
        <ConfirmDialog
          title="Excluir registro?"
          message="Essa ação não pode ser desfeita."
          tone="danger"
          onConfirm={() =>
            run(async () => {
              await removeRow(confirmingDeleteId);
              setConfirmingDeleteId(null);
            })
          }
          onCancel={() => setConfirmingDeleteId(null)}
        />
      )}
    </>,
  );
}
