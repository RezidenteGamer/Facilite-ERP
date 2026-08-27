import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import ConfirmDialog from "../../components/ConfirmDialog";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import { supabase } from "../../lib/supabaseClient";
import { useAuth } from "../auth/AuthContext";
import { extractErrorMessage } from "../modules/useGenericModuleData";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import DeleteModuleDialog from "./DeleteModuleDialog";
import FieldCanvas from "./FieldCanvas";
import FieldFormModal from "./FieldFormModal";
import NewModuleModal from "./NewModuleModal";
import { fieldEditingCapabilityFor, type NewModuleField, type NewModuleInput } from "./moduleBuilder";
import { useModuleBuilderData } from "./useModuleBuilderData";
import WorkflowSection from "./WorkflowSection";
import "./ModuleBuilderPage.css";

type ModalState =
  | { kind: "none" }
  | { kind: "new-module" }
  | { kind: "new-field" }
  | { kind: "remove-field"; field: ModuleFieldDefinition }
  | { kind: "delete-module" };

/**
 * O cartão do canvas edita um pedaço de cada vez (o rótulo, o tipo, uma
 * flag), mas `updateModuleField` continua mandando o patch inteiro — inclusive
 * `referenceModuleId`. Sem levar o valor atual junto, mexer no rótulo de um
 * campo de referência apagaria a referência, e o trigger do banco recusaria a
 * edição com um erro inexplicável para quem só queria trocar uma palavra.
 */
function toFormValues(
  field: ModuleFieldDefinition,
  patch: Partial<NewModuleField> = {},
): NewModuleField {
  return {
    label: field.label,
    dataType: field.dataType,
    isRequired: field.isRequired,
    showInTable: field.showInTable,
    showInDetails: field.showInDetails,
    showInForm: field.showInForm,
    referenceModuleId: field.referenceModuleId,
    ...patch,
  };
}

/**
 * Construtor de módulos (`/modulos`) — a tela que faltava para o motor
 * genérico. É a M3: um usuário autorizado cria um módulo, define os campos e
 * o módulo passa a existir com rota, tile e CRUD completo, **sem deploy**.
 *
 * Fica fora do catálogo de módulos comuns, na mesma categoria de `/permissoes`
 * e `/usuarios-operadores`: o portão é a flag global `can_manage_modules` do
 * papel, não `has_permission` — no momento de criar um módulo ainda não existe
 * `module_id` para `has_permission` resolver.
 */
export default function ModuleBuilderPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { profile } = useAuth();

  const {
    modules,
    selected,
    selectedId,
    setSelectedId,
    fields,
    error,
    createModule,
    deleteModule,
    addField,
    editField,
    reorderFields,
    dropField,
  } = useModuleBuilderData();

  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [recordCount, setRecordCount] = useState<number | null>(null);

  const canManageModules = Boolean(profile?.canManageModules);
  const isFaciliteDeveloper = Boolean(profile?.isFaciliteDeveloper);

  const moduleLabels = useMemo(
    () => Object.fromEntries(modules.map((module) => [module.id, module.label])),
    [modules],
  );

  /**
   * Um campo de referência guarda um `module_records.id`, então só faz
   * sentido apontar para outro módulo de armazenamento genérico. A lista
   * fica vazia para quem não é desenvolvedor do Facilite — e vazia é o que
   * esconde o controle inteiro no `FieldFormModal`.
   */
  const referenceChoices = useMemo(() => {
    if (!isFaciliteDeveloper || !selected || selected.storageKind !== "generic") return [];
    return modules
      .filter((module) => module.storageKind === "generic" && module.id !== selected.id)
      .map((module) => ({ id: module.id, label: module.label }));
  }, [isFaciliteDeveloper, modules, selected]);

  useEffect(() => {
    openWindow({ id: "modulos", label: "Módulos", path: "/modulos" });
  }, [openWindow]);

  /* Quantos registros o módulo tem — só para a confirmação de exclusão dizer
     o tamanho real do estrago, em vez de um "isso não pode ser desfeito" seco. */
  useEffect(() => {
    if (modal.kind !== "delete-module" || !selected || !supabase) return;
    setRecordCount(null);
    let cancelled = false;
    supabase
      .from("module_records")
      .select("id", { count: "exact", head: true })
      .eq("module_id", selected.id)
      .then(({ count }) => {
        if (!cancelled) setRecordCount(count ?? 0);
      });
    return () => {
      cancelled = true;
    };
  }, [modal.kind, selected]);

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
      setModal({ kind: "none" });
    } catch (err) {
      setActionError(extractErrorMessage(err, "Não foi possível concluir a operação."));
    }
  }

  if (!canManageModules) {
    return (
      <AppShell navItems={navItems} secondaryText="Módulos">
        <p style={{ color: "var(--white)", padding: 24 }}>
          Você não tem permissão para gerenciar módulos.
        </p>
      </AppShell>
    );
  }

  const capability = selected ? fieldEditingCapabilityFor(selected) : null;
  const canAddField = capability?.kind === "full";
  const canEditField = capability?.kind === "full" || capability?.kind === "existing-only";

  return (
    <AppShell navItems={navItems} secondaryText="Módulos">
      <div className="module-builder">
        <div className="module-builder__header">
          <div>
            <h1 className="module-builder__title">Módulos</h1>
            <p className="module-builder__subtitle">
              Crie um módulo novo ou ajuste os campos de um módulo que já roda no motor genérico.
            </p>
          </div>
          <button
            className="module-builder__btn"
            type="button"
            onClick={() => setModal({ kind: "new-module" })}
          >
            Novo módulo
          </button>
        </div>

        {(error || actionError) && (
          <p className="module-builder__error">{actionError ?? error}</p>
        )}

        <div className="module-builder__body">
          <ul className="module-builder__modules">
            {modules.map((module) => (
              <li key={module.id}>
                <button
                  className={`module-builder__module${
                    module.id === selectedId ? " module-builder__module--selected" : ""
                  }`}
                  type="button"
                  onClick={() => setSelectedId(module.id)}
                >
                  <span className="module-builder__module-label">{module.label}</span>
                  <span className="module-builder__module-meta">
                    {module.isLocked ? "Sistema" : "Do usuário"} ·{" "}
                    {module.storageKind === "generic"
                      ? "module_records"
                      : (module.dataTable ?? "sem tabela")}
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <section className="module-builder__detail">
            {!selected ? (
              <p className="module-builder__empty">Selecione um módulo à esquerda.</p>
            ) : (
              <>
                <div className="module-builder__detail-head">
                  <div>
                    <h2 className="module-builder__detail-title">{selected.label}</h2>
                    <p className="module-builder__detail-meta">
                      <code>{selected.id}</code>
                      {selected.path && <> · rota {selected.path}</>}
                      {selected.branchScoped && <> · isolado por filial</>}
                    </p>
                  </div>

                  <div className="module-builder__detail-actions">
                    {!selected.isLocked && (
                      <button
                        className="module-builder__btn module-builder__btn--small module-builder__btn--danger"
                        type="button"
                        onClick={() => setModal({ kind: "delete-module" })}
                      >
                        Excluir módulo
                      </button>
                    )}
                  </div>
                </div>

                {capability?.reason && (
                  <p className="module-builder__notice">{capability.reason}</p>
                )}

                {/* O canvas de campos no lugar da tabela técnica. A fronteira
                    de quem pode editar o quê é a mesma de M3 — só a superfície
                    mudou: `canAdd` (só `generic`) libera adicionar e remover;
                    `canEdit` (também `table` sem tela própria) libera rótulo,
                    tipo, flags e ordem; módulo com tela própria não recebe
                    nenhum dos dois e fica só com a mensagem de recusa. */}
                {capability?.kind !== "none" && (
                  <FieldCanvas
                    fields={fields}
                    moduleLabel={selected.label}
                    moduleLabels={moduleLabels}
                    canAdd={canAddField}
                    canEdit={canEditField}
                    referenceChoices={referenceChoices}
                    onAdd={() => setModal({ kind: "new-field" })}
                    onRemove={(field) => setModal({ kind: "remove-field", field })}
                    onPatch={(field, patch) =>
                      run(() => editField(field.id, toFormValues(field, patch)))
                    }
                    onReorder={(orderedIds) => reorderFields(orderedIds)}
                  />
                )}

                {/* Workflow só existe em módulo de armazenamento genérico — a
                    mesma fronteira que M3 traçou para campos personalizados, e
                    a mesma que `assert_module_workflow_editable` impõe no
                    banco. Módulo com tela própria não olha para estes
                    metadados, então oferecer a seção seria mentira. */}
                {capability?.kind === "full" && (
                  <WorkflowSection
                    moduleId={selected.id}
                    moduleLabel={selected.label}
                    fields={fields}
                    moduleLabels={moduleLabels}
                    isFaciliteDeveloper={isFaciliteDeveloper}
                  />
                )}
              </>
            )}
          </section>
        </div>
      </div>

      {modal.kind === "new-module" && (
        <NewModuleModal
          onSubmit={(input: NewModuleInput) => run(() => createModule(input).then(() => undefined))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "new-field" && selected && (
        <FieldFormModal
          title={`Novo campo — ${selected.label}`}
          submitLabel="Adicionar"
          referenceChoices={referenceChoices}
          onSubmit={(field) => run(() => addField(selected.id, field))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "remove-field" && (
        <ConfirmDialog
          title={`Remover o campo “${modal.field.label}”?`}
          message="Ele some da tabela, da ficha e do formulário. O valor já gravado nos registros existentes continua no banco — remover um campo para de mostrar o dado, não o apaga."
          confirmLabel="Remover"
          tone="danger"
          onConfirm={() => run(() => dropField(modal.field.id))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "delete-module" && selected && (
        <DeleteModuleDialog
          module={selected}
          recordCount={recordCount}
          onConfirm={() => run(() => deleteModule(selected.id))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}
    </AppShell>
  );
}
