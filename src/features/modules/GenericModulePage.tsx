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
import type { GenericRow } from "../../lib/repositories/genericModuleRepository";
import type { CatalogModule } from "./catalog";
import { extractErrorMessage, useGenericModuleData } from "./useGenericModuleData";

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
    createRow,
    updateRow,
    removeRow,
  } = useGenericModuleData({
    table: definition?.dataTable ?? null,
    fields,
    branchId: currentBranchId,
    branchScoped: module.branchScoped,
    enabled: canView && Boolean(definition?.dataTable),
  });

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
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    const searchable = fields.filter((field) => field.showInTable);
    return rows.filter((row) =>
      searchable.some((field) => String(row[field.accessorKey] ?? "").toLowerCase().includes(term)),
    );
  }, [rows, search, fields]);

  const selected: GenericRow | null = visibleRows.find((row) => row.id === selectedId) ?? null;

  const columns = useMemo(() => buildTableColumns<GenericRow>(fields), [fields]);
  const detailFields = useMemo(() => buildDetailFields<GenericRow>(fields, selected), [fields, selected]);
  const formFields = useMemo(() => buildFormFields(fields), [fields]);

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

  /* Um módulo de catálogo sem `data_table` é uma entrada de navegação sem
     dados próprios (tela mock, tela administrativa). Sem componente e sem
     tabela não há o que montar — dizer isso é melhor que uma tela vazia. */
  if (!definition.dataTable) {
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
            { id: "novo", label: "Novo", disabled: !canCreate, onClick: () => setModal("new") },
            {
              id: "editar",
              label: "Editar",
              disabled: !selected || !canEdit,
              onClick: () => setModal("edit"),
            },
            {
              id: "excluir",
              label: "Excluir",
              disabled: !selected || !canDelete,
              detached: true,
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
