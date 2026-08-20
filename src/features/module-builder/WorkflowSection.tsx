import { useState } from "react";
import ConfirmDialog from "../../components/ConfirmDialog";
import {
  isCrossModuleAction,
  type ModuleSituation,
  type ModuleTransition,
  type ModuleTransitionAction,
} from "../modules/moduleWorkflow";
import { extractErrorMessage } from "../modules/useGenericModuleData";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import ActionFormModal from "./ActionFormModal";
import SituationFormModal from "./SituationFormModal";
import TransitionFormModal from "./TransitionFormModal";
import { useModuleWorkflowBuilder, type ReferenceTarget } from "./useModuleWorkflowBuilder";
import "./ModuleBuilderPage.css";

type WorkflowSectionProps = {
  moduleId: string;
  moduleLabel: string;
  fields: ModuleFieldDefinition[];
  /** `modules.id` → rótulo, para nomear o módulo do outro lado de uma referência. */
  moduleLabels: Record<string, string>;
  /** Libera os controles de Camada 2 (ler/escrever em módulo relacionado). */
  isFaciliteDeveloper: boolean;
};

type ModalState =
  | { kind: "none" }
  | { kind: "situation"; situation?: ModuleSituation }
  | { kind: "remove-situation"; situation: ModuleSituation }
  | { kind: "transition"; transition?: ModuleTransition }
  | { kind: "remove-transition"; transition: ModuleTransition }
  | { kind: "action"; transition: ModuleTransition; action?: ModuleTransitionAction }
  | { kind: "remove-action"; action: ModuleTransitionAction };

function fieldLabel(fields: ModuleFieldDefinition[], key: string): string {
  return fields.find((field) => field.fieldKey === key)?.label ?? key;
}

/**
 * A ação em português, do jeito que ela vai acontecer. Um `target_kind` e um
 * `value_kind` lado a lado numa tabela não dizem nada a quem vai conferir se
 * a automação está certa — e conferir é justamente o que a Camada 2 exige.
 */
function describeAction(
  action: ModuleTransitionAction,
  ownFields: ModuleFieldDefinition[],
  references: ReferenceTarget[],
): string {
  const reference = action.viaReferenceFieldKey
    ? references.find((item) => item.fieldKey === action.viaReferenceFieldKey)
    : null;
  const otherModule = reference?.moduleLabel ?? "outro módulo";

  const targetFields = action.targetKind === "related_record" ? (reference?.fields ?? []) : ownFields;
  const target = `“${fieldLabel(targetFields, action.targetFieldKey)}”`;
  const where = action.targetKind === "related_record" ? `${target} em ${otherModule}` : target;

  let value: string;
  if (action.valueKind === "literal") {
    value = `“${action.value ?? ""}”`;
  } else if (action.valueKind === "now") {
    value = "a data/hora da transição";
  } else if (action.valueKind === "current_user") {
    value = "o usuário que acionou";
  } else {
    value = `“${fieldLabel(reference?.fields ?? [], action.sourceFieldKey ?? "")}” de ${otherModule}`;
  }

  const via = reference ? ` (via “${reference.fieldLabel}”)` : "";
  return `Preenche ${where} com ${value}${via}`;
}

/**
 * Seção de situações, transições e ações do construtor de módulos (M4).
 *
 * Só aparece em módulo de armazenamento genérico — a mesma fronteira que M3
 * já traçou para campos personalizados, e a mesma que a RPC impõe no banco.
 */
export default function WorkflowSection({
  moduleId,
  moduleLabel,
  fields,
  moduleLabels,
  isFaciliteDeveloper,
}: WorkflowSectionProps) {
  const {
    situations,
    situationById,
    transitions,
    actionsByTransition,
    references,
    error,
    saveSituation,
    removeSituation,
    saveTransition,
    removeTransition,
    saveAction,
    removeAction,
  } = useModuleWorkflowBuilder(moduleId, fields, moduleLabels);

  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);

  /* Camada 2 escondida, não desabilitada: sem a característica de
     desenvolvedor do Facilite os saltos de referência simplesmente não
     existem para os formulários, e a Camada 1 continua inteira. */
  const availableReferences = isFaciliteDeveloper ? references : [];

  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
      setModal({ kind: "none" });
    } catch (err) {
      setActionError(extractErrorMessage(err, "Não foi possível concluir a operação."));
    }
  }

  return (
    <section className="module-builder__workflow">
      <div className="module-builder__workflow-head">
        <div>
          <h3 className="module-builder__workflow-title">Situações e transições</h3>
          <p className="module-builder__workflow-sub">
            Cada registro de {moduleLabel} carrega uma situação, e muda de situação pelos botões
            que as transições criam na ficha.
          </p>
        </div>
        <button
          className="module-builder__btn module-builder__btn--small"
          type="button"
          onClick={() => setModal({ kind: "situation" })}
        >
          Nova situação
        </button>
      </div>

      {(error || actionError) && (
        <p className="module-builder__error">{actionError ?? error}</p>
      )}

      {situations.length === 0 ? (
        <p className="module-builder__empty">
          Este módulo ainda não tem situações. A primeira que você criar vira a situação inicial.
        </p>
      ) : (
        <ul className="module-builder__wf-list">
          {situations.map((situation) => (
            <li className="module-builder__wf-item" key={situation.id}>
              <div className="module-builder__wf-main">
                <span className="module-builder__wf-label">{situation.label}</span>
                <span className="module-builder__wf-meta">
                  <code>{situation.code}</code>
                  {situation.isInitial && (
                    <span className="module-builder__badge">inicial</span>
                  )}
                </span>
              </div>
              <div className="module-builder__wf-actions">
                <button
                  className="module-builder__link"
                  type="button"
                  onClick={() => setModal({ kind: "situation", situation })}
                >
                  Editar
                </button>
                <button
                  className="module-builder__link module-builder__link--danger"
                  type="button"
                  onClick={() => setModal({ kind: "remove-situation", situation })}
                >
                  Excluir
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {situations.length >= 2 && (
        <>
          <div className="module-builder__workflow-head">
            <h3 className="module-builder__workflow-title">Transições</h3>
            <button
              className="module-builder__btn module-builder__btn--small"
              type="button"
              onClick={() => setModal({ kind: "transition" })}
            >
              Nova transição
            </button>
          </div>

          {transitions.length === 0 ? (
            <p className="module-builder__empty">
              Nenhuma transição ainda — sem elas, o registro fica parado na situação inicial.
            </p>
          ) : (
            <ul className="module-builder__wf-list">
              {transitions.map((transition) => (
                <li className="module-builder__wf-item" key={transition.id}>
                  <div className="module-builder__wf-main">
                    <span className="module-builder__wf-label">{transition.label}</span>
                    <span className="module-builder__wf-meta">
                      {situationById[transition.fromSituationId]?.label ?? "?"} →{" "}
                      {situationById[transition.toSituationId]?.label ?? "?"}
                    </span>

                    <ul className="module-builder__wf-sublist">
                      {(actionsByTransition[transition.id] ?? []).map((action) => (
                        <li className="module-builder__wf-subitem" key={action.id}>
                          <span>
                            {describeAction(action, fields, references)}
                            {isCrossModuleAction(action) && (
                              <span className="module-builder__badge">outro módulo</span>
                            )}
                          </span>
                          <button
                            className="module-builder__link module-builder__link--danger"
                            type="button"
                            onClick={() => setModal({ kind: "remove-action", action })}
                          >
                            Remover
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="module-builder__wf-actions">
                    <button
                      className="module-builder__link"
                      type="button"
                      onClick={() => setModal({ kind: "action", transition })}
                    >
                      Nova ação
                    </button>
                    <button
                      className="module-builder__link"
                      type="button"
                      onClick={() => setModal({ kind: "transition", transition })}
                    >
                      Editar
                    </button>
                    <button
                      className="module-builder__link module-builder__link--danger"
                      type="button"
                      onClick={() => setModal({ kind: "remove-transition", transition })}
                    >
                      Excluir
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {modal.kind === "situation" && (
        <SituationFormModal
          title={modal.situation ? `Editar situação — ${modal.situation.label}` : "Nova situação"}
          initial={
            modal.situation
              ? {
                  id: modal.situation.id,
                  label: modal.situation.label,
                  sortOrder: modal.situation.sortOrder,
                  isInitial: modal.situation.isInitial,
                }
              : undefined
          }
          lockedCode={modal.situation?.code}
          lockInitial={modal.situation?.isInitial ?? false}
          submitLabel={modal.situation ? "Salvar" : "Criar"}
          onSubmit={(input) => run(() => saveSituation(input))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "remove-situation" && (
        <ConfirmDialog
          title={`Excluir a situação “${modal.situation.label}”?`}
          message="Só sai se nenhum registro estiver nela e nenhuma transição a usar — o banco recusa nos dois casos, e diz qual é o impedimento."
          confirmLabel="Excluir"
          onConfirm={() => run(() => removeSituation(modal.situation.id))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "transition" && (
        <TransitionFormModal
          title={
            modal.transition ? `Editar transição — ${modal.transition.label}` : "Nova transição"
          }
          situations={situations}
          initial={
            modal.transition
              ? {
                  id: modal.transition.id,
                  fromSituationId: modal.transition.fromSituationId,
                  toSituationId: modal.transition.toSituationId,
                  label: modal.transition.label,
                  sortOrder: modal.transition.sortOrder,
                }
              : undefined
          }
          lockPair={Boolean(modal.transition)}
          submitLabel={modal.transition ? "Salvar" : "Criar"}
          onSubmit={(input) => run(() => saveTransition(input))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "remove-transition" && (
        <ConfirmDialog
          title={`Excluir a transição “${modal.transition.label}”?`}
          message="As ações automáticas configuradas nela vão junto. Os registros continuam nas situações onde já estão."
          confirmLabel="Excluir"
          onConfirm={() => run(() => removeTransition(modal.transition.id))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "action" && (
        <ActionFormModal
          title={`Nova ação — ${modal.transition.label}`}
          ownFields={fields}
          references={availableReferences}
          submitLabel="Adicionar"
          onSubmit={(input) => run(() => saveAction(modal.transition.id, input))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}

      {modal.kind === "remove-action" && (
        <ConfirmDialog
          title="Remover esta ação automática?"
          message="A transição continua existindo; ela só deixa de preencher esse campo."
          confirmLabel="Remover"
          onConfirm={() => run(() => removeAction(modal.action.id))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}
    </section>
  );
}
