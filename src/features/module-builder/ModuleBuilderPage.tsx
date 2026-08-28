import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  planFieldsJson,
  planHasWork,
  snapshotToFieldsJson,
  type FieldsPlan,
} from "./fieldsJsonPlan";
import FieldFormModal from "./FieldFormModal";
import NewModuleModal from "./NewModuleModal";
import { fieldEditingCapabilityFor, type NewModuleField, type NewModuleInput } from "./moduleBuilder";
import { useFieldsHistory, type FieldsSnapshot } from "./useFieldsHistory";
import { useModuleBuilderData } from "./useModuleBuilderData";
import WorkflowSection from "./WorkflowSection";
import "./ModuleBuilderPage.css";

type ModalState =
  | { kind: "none" }
  | { kind: "new-module" }
  | { kind: "new-field" }
  | { kind: "remove-field"; field: ModuleFieldDefinition }
  /** Remoção em lote pela seleção múltipla — mesmo diálogo de atrito, no plural. */
  | { kind: "remove-fields"; fields: ModuleFieldDefinition[] }
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
 * e `/usuarios-operadores`: o portão nunca foi `has_permission` — no momento de
 * criar um módulo ainda não existe `module_id` para ele resolver.
 *
 * **Quem passa mudou em 28/08/2026** (decisão de produto, ver `AGENTS.md`): não
 * é mais `roles.can_manage_modules` — flag de papel que o administrador do
 * cliente liga sozinho — e sim `profiles.is_facilite_developer`, flag de pessoa
 * ligada só por SQL. O construtor deixou de ser recurso self-service do cliente
 * final: quem define campos, tipos, visibilidade e workflow está programando, e
 * o cliente comum tipicamente nem sabe descrever o que quer. A ferramenta
 * continua existindo; quem a opera é a Facilite, montando o módulo sob encomenda
 * com a mesma engine genérica.
 */
export default function ModuleBuilderPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { profile, currentBranchId, hasPermission } = useAuth();

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
    applyFieldsPlan,
  } = useModuleBuilderData();

  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [recordCount, setRecordCount] = useState<number | null>(null);
  const [fieldsView, setFieldsView] = useState<"editor" | "json">("editor");

  const isFaciliteDeveloper = Boolean(profile?.isFaciliteDeveloper);

  const moduleLabels = useMemo(
    () => Object.fromEntries(modules.map((module) => [module.id, module.label])),
    [modules],
  );

  /**
   * Um campo de referência guarda um `module_records.id`, então só faz
   * sentido apontar para outro módulo de armazenamento genérico. A checagem
   * de desenvolvedor continua aqui por simetria com a RPC que impõe a Camada 2
   * no banco — depois do novo portão da página ela é sempre verdadeira para
   * quem chegou até aqui, e é justamente isso que se quer: uma condição a mais
   * que nunca contradiz o banco.
   */
  const referenceChoices = useMemo(() => {
    if (!isFaciliteDeveloper || !selected || selected.storageKind !== "generic") return [];
    return modules
      .filter((module) => module.storageKind === "generic" && module.id !== selected.id)
      .map((module) => ({ id: module.id, label: module.label }));
  }, [isFaciliteDeveloper, modules, selected]);

  /**
   * Aplicar uma lista de campos desejada — é o que desfazer, refazer e as
   * ações em lote do Inspetor têm em comum, e é exatamente o problema que
   * `fieldsJsonPlan.ts` (Fase 2) já resolve: comparar a lista pedida com a
   * atual e decidir quais `updateModuleField`/`addModuleField`/
   * `removeModuleField`/`reorderModuleFields` faltam. Nenhum caminho de
   * gravação novo nasceu na Fase 4 — os três reaproveitam este.
   *
   * A recusa vem pronta da mesma validação (fronteira de M3 inclusive: um
   * módulo `table` sem tela própria não aceita criação nem remoção, então
   * desfazer uma remoção que nunca poderia ter acontecido ali é recusado com
   * o nome da tabela, sem escrever nada).
   */
  const applyFieldsSnapshot = useCallback(
    async (snapshot: FieldsSnapshot) => {
      if (!selected) return;
      const result = planFieldsJson(snapshotToFieldsJson(snapshot, fields), fields, {
        allowStructuralChanges: fieldEditingCapabilityFor(selected).kind === "full",
        storageLabel: selected.dataTable,
      });
      if (!result.ok) {
        setActionError(result.error);
        return;
      }
      if (!planHasWork(result.plan)) return;
      await applyFieldsPlan(selected.id, result.plan);
    },
    [selected, fields, applyFieldsPlan],
  );

  const history = useFieldsHistory(applyFieldsSnapshot);
  const { record: recordHistory, reset: resetHistory } = history;

  /* A pilha é do módulo selecionado: os ids de um não dizem nada sobre o
     outro, e desfazer depois de trocar de módulo tentaria recriar campos que
     nunca existiram ali. */
  useEffect(() => {
    resetHistory();
  }, [selectedId, resetHistory]);

  /** Envolve uma ação que muda campos, guardando o estado anterior primeiro. */
  function withHistory<T>(action: () => Promise<T>): Promise<T> {
    recordHistory(fields);
    return action();
  }

  async function runHistoryStep(step: (current: FieldsSnapshot) => Promise<void>) {
    setActionError(null);
    try {
      await step(fields);
    } catch (err) {
      setActionError(extractErrorMessage(err, "Não foi possível concluir a operação."));
    }
  }

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

  /* Mesma recusa que `ModuleRoute` já daria pela rota do catálogo — repetida
     aqui porque a tela também é alcançável direto pelo componente registrado
     em `MODULE_COMPONENTS`, e um portão que só existe num dos caminhos não é
     portão. */
  if (!isFaciliteDeveloper) {
    return (
      <AppShell navItems={navItems} secondaryText="Módulos">
        <p style={{ color: "var(--white)", padding: 24 }}>
          O construtor de módulos é uma ferramenta interna da Facilite.
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

                {/* Editor de campos em três painéis (lista | prévia com a
                    tabela real | Inspetor), no lugar da grade de cartões. A
                    fronteira de quem pode editar o quê é a mesma de M3 — só a
                    superfície mudou: `canAdd` (só `generic`) libera adicionar e
                    remover; `canEdit` (também `table` sem tela própria) libera
                    rótulo, tipo, flags e ordem; módulo com tela própria não
                    recebe nenhum dos dois e fica só com a mensagem de recusa. */}
                {capability?.kind !== "none" && (
                  <div className="module-builder__canvas-block">
                    <div className="module-builder__view-tabs">
                      <button
                        type="button"
                        className={`module-builder__view-tab${
                          fieldsView === "editor" ? " module-builder__view-tab--on" : ""
                        }`}
                        onClick={() => setFieldsView("editor")}
                      >
                        Editor
                      </button>
                      <button
                        type="button"
                        className={`module-builder__view-tab${
                          fieldsView === "json" ? " module-builder__view-tab--on" : ""
                        }`}
                        onClick={() => setFieldsView("json")}
                      >
                        Ver como JSON
                      </button>
                    </div>

                    {fieldsView === "editor" ? (
                      <FieldCanvas
                        key={selected.id}
                        fields={fields}
                        module={selected}
                        moduleLabels={moduleLabels}
                        canAdd={canAddField}
                        canEdit={canEditField}
                        referenceChoices={referenceChoices}
                        branchId={currentBranchId}
                        canViewRecords={hasPermission(selected.id, "view")}
                        shortcutsEnabled={modal.kind === "none"}
                        canUndo={history.canUndo}
                        canRedo={history.canRedo}
                        onUndo={() => runHistoryStep(history.undo)}
                        onRedo={() => runHistoryStep(history.redo)}
                        onAdd={() => setModal({ kind: "new-field" })}
                        onRemove={(field) => setModal({ kind: "remove-field", field })}
                        onRemoveMany={(selection) =>
                          setModal({ kind: "remove-fields", fields: selection })
                        }
                        onApplyFields={(next) =>
                          runHistoryStep(() => withHistory(() => applyFieldsSnapshot(next)))
                        }
                        onPatch={(field, patch) =>
                          run(() => withHistory(() => editField(field.id, toFormValues(field, patch))))
                        }
                        onReorder={(orderedIds) =>
                          withHistory(async () => {
                            await reorderFields(orderedIds);
                          })
                        }
                      />
                    ) : (
                      <FieldsJsonView
                        key={selected.id}
                        fields={fields}
                        canAdd={canAddField}
                        storageLabel={selected.dataTable}
                        onApply={(plan) =>
                          withHistory(() => applyFieldsPlan(selected.id, plan))
                        }
                      />
                    )}
                  </div>
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
          onSubmit={(field) => run(() => withHistory(() => addField(selected.id, field)))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "remove-field" && (
        <ConfirmDialog
          title={`Remover o campo “${modal.field.label}”?`}
          message="Ele some da tabela, da ficha e do formulário. O valor já gravado nos registros existentes continua no banco — remover um campo para de mostrar o dado, não o apaga."
          confirmLabel="Remover"
          tone="danger"
          onConfirm={() => run(() => withHistory(() => dropField(modal.field.id)))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {/* Mesma frase de atrito da remoção de um campo, no plural: o que muda é
          só quantos campos somem de uma vez, não o que acontece com o dado. */}
      {modal.kind === "remove-fields" && (
        <ConfirmDialog
          title={`Remover ${modal.fields.length} campos?`}
          message={`Somem da tabela, da ficha e do formulário: ${modal.fields
            .map((field) => `“${field.label}”`)
            .join(", ")}. O valor já gravado nos registros existentes continua no banco — remover um campo para de mostrar o dado, não o apaga.`}
          confirmLabel="Remover"
          tone="danger"
          onConfirm={() => {
            const removing = new Set(modal.fields.map((field) => field.id));
            run(() =>
              withHistory(() =>
                applyFieldsSnapshot(fields.filter((field) => !removing.has(field.id))),
              ),
            );
          }}
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

/**
 * Visão de `fields` como JSON editável — mesma estrutura que
 * `ModuleFieldDefinition` já usa internamente, sem tradução. Serve para
 * configurar um módulo inteiro de uma vez (colar a lista pronta) em vez de
 * abrir um cartão por campo: é o caminho de um dev, e o de uma sessão do
 * Claude Code, que lê o estado exato do módulo sem inspecionar o canvas via
 * screenshot/DOM e devolve a lista já editada.
 *
 * O texto é **estado próprio**, não uma projeção de `fields`: editar não mexe
 * em campo nenhum até o "Aplicar". Quando `fields` muda de verdade (a
 * aplicação terminou), o texto é sincronizado de novo com o estado do banco.
 *
 * Três coisas que a lista *não* controla, e que a dica na tela diz em voz alta:
 * `sortOrder` (quem manda é a posição no array), `tableWidth`/`tableAlign` (não
 * há como gravá-los por aqui) e a chave física de um campo que já existe.
 */
function FieldsJsonView({
  fields,
  canAdd,
  storageLabel,
  onApply,
}: {
  fields: ModuleFieldDefinition[];
  canAdd: boolean;
  storageLabel: string | null;
  onApply: (plan: FieldsPlan) => Promise<string[]>;
}) {
  const json = useMemo(() => JSON.stringify(fields, null, 2), [fields]);
  const [text, setText] = useState(json);
  const seeded = useRef(json);
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

  /* Só quando o JSON de verdade muda — o que, nesta tela, quer dizer "a
     aplicação passou". Recarregar o texto com o estado do banco é o passo que
     mostra os ids reais dos campos recém-criados. */
  useEffect(() => {
    if (json === seeded.current) return;
    seeded.current = json;
    setText(json);
  }, [json]);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  async function handleApply() {
    const result = planFieldsJson(text, fields, {
      allowStructuralChanges: canAdd,
      storageLabel,
    });
    if (!result.ok) {
      setStatus({ tone: "error", message: result.error });
      return;
    }
    if (!planHasWork(result.plan)) {
      setStatus({ tone: "ok", message: "Nada a aplicar: a lista já é igual à do módulo." });
      return;
    }

    setApplying(true);
    try {
      const applied = await onApply(result.plan);
      setStatus({ tone: "ok", message: `Aplicado: ${applied.join("; ")}.` });
    } catch (err) {
      setStatus({
        tone: "error",
        message: extractErrorMessage(err, "Não foi possível aplicar a lista."),
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="module-builder__json-block">
      <div className="module-builder__json-toolbar">
        <p className="module-builder__json-hint">
          A ordem da lista vira a ordem dos campos. Item sem <code>id</code> cria um campo (a chave
          sai do rótulo); <code>id</code> que sumir da lista remove o campo. <code>sortOrder</code>,{" "}
          <code>tableWidth</code> e <code>tableAlign</code> são ignorados, e nada é gravado até
          "Aplicar".
        </p>
        <div className="module-builder__json-actions">
          <button
            type="button"
            className="module-builder__btn module-builder__btn--small"
            onClick={handleCopy}
          >
            {copied ? "Copiado!" : "Copiar"}
          </button>
          <button
            type="button"
            className="module-builder__btn module-builder__btn--small"
            onClick={handleApply}
            disabled={applying}
          >
            {applying ? "Aplicando…" : "Aplicar"}
          </button>
        </div>
      </div>
      <textarea
        className="module-builder__json-textarea"
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setStatus(null);
        }}
        spellCheck={false}
        disabled={applying}
      />
      {status && (
        <p
          className={`module-builder__json-status module-builder__json-status--${
            status.tone === "ok" ? "ok" : "error"
          }`}
        >
          {status.message}
        </p>
      )}
    </div>
  );
}
