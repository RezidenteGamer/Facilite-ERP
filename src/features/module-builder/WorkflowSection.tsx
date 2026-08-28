import { useEffect, useMemo, useRef, useState } from "react";
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
import WorkflowCanvas, { type Selection } from "./WorkflowCanvas";
import {
  planWorkflowJson,
  workflowPlanHasWork,
  workflowToJson,
  type WorkflowPlan,
  type WorkflowSnapshot,
} from "./workflowJsonPlan";
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
  | { kind: "transition"; transition?: ModuleTransition; from?: string; to?: string }
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
 * Situações e transições do módulo (M4), agora como **diagrama**: nós
 * posicionáveis e setas com sentido, no lugar das duas listas que existiam.
 *
 * O que **não** mudou: a seção só aparece em módulo de armazenamento genérico
 * (mesma fronteira de M3, e a mesma que `assert_module_workflow_editable`
 * impõe no banco), a inicial não pode ser desmarcada — só substituída —, e a
 * Camada 2 continua invisível para quem não é desenvolvedor do Facilite,
 * porque `availableReferences` chega vazio aos formulários. Só a superfície é
 * outra.
 *
 * As ações de uma transição vivem no painel lateral, não no desenho: uma
 * aresta com três frases penduradas viraria um emaranhado, e conferir a
 * automação (que é o que a Camada 2 exige) pede texto corrido, não rótulo de
 * seta.
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
    moveSituation,
    removeSituation,
    saveTransition,
    removeTransition,
    saveAction,
    removeAction,
    applyWorkflowPlan,
  } = useModuleWorkflowBuilder(moduleId, fields, moduleLabels);

  const [modal, setModal] = useState<ModalState>({ kind: "none" });
  const [actionError, setActionError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [view, setView] = useState<"diagram" | "json">("diagram");

  const snapshot = useMemo<WorkflowSnapshot>(
    () => ({ situations, transitions, actionsByTransition }),
    [situations, transitions, actionsByTransition],
  );

  /* Camada 2 escondida, não desabilitada: sem a característica de
     desenvolvedor do Facilite os saltos de referência simplesmente não
     existem para os formulários, e a Camada 1 continua inteira. */
  const availableReferences = isFaciliteDeveloper ? references : [];

  const selectedSituation =
    selection?.kind === "situation"
      ? (situations.find((situation) => situation.id === selection.id) ?? null)
      : null;
  const selectedTransition =
    selection?.kind === "transition"
      ? (transitions.find((transition) => transition.id === selection.id) ?? null)
      : null;

  async function run(action: () => Promise<void>) {
    setActionError(null);
    try {
      await action();
      setModal({ kind: "none" });
    } catch (err) {
      setActionError(extractErrorMessage(err, "Não foi possível concluir a operação."));
    }
  }

  const panel = (() => {
    if (selectedSituation) {
      return (
        <>
          <p className="module-builder__panel-kind">Situação</p>
          <h4 className="module-builder__panel-title">{selectedSituation.label}</h4>
          <p className="module-builder__panel-meta">
            <code>{selectedSituation.code}</code>
            {selectedSituation.isInitial && (
              <span className="module-builder__badge">inicial</span>
            )}
          </p>
          {selectedSituation.isInitial && (
            <p className="module-builder__hint">
              Todo registro novo nasce aqui. Para trocar, marque outra como inicial — o módulo não
              pode ficar sem nenhuma.
            </p>
          )}
          <div className="module-builder__panel-actions">
            <button
              className="module-builder__link"
              type="button"
              onClick={() => setModal({ kind: "situation", situation: selectedSituation })}
            >
              Editar
            </button>
            <button
              className="module-builder__link module-builder__link--danger"
              type="button"
              onClick={() => setModal({ kind: "remove-situation", situation: selectedSituation })}
            >
              Excluir
            </button>
          </div>
        </>
      );
    }

    if (selectedTransition) {
      const actions = actionsByTransition[selectedTransition.id] ?? [];
      return (
        <>
          <p className="module-builder__panel-kind">Transição</p>
          <h4 className="module-builder__panel-title">{selectedTransition.label}</h4>
          <p className="module-builder__panel-meta">
            {situationById[selectedTransition.fromSituationId]?.label ?? "?"} →{" "}
            {situationById[selectedTransition.toSituationId]?.label ?? "?"}
          </p>

          <p className="module-builder__panel-kind">Ações automáticas</p>
          {actions.length === 0 ? (
            <p className="module-builder__empty">
              Nenhuma — a transição só muda a situação do registro.
            </p>
          ) : (
            <ul className="module-builder__wf-sublist">
              {actions.map((action) => (
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
          )}

          <div className="module-builder__panel-actions">
            <button
              className="module-builder__link"
              type="button"
              onClick={() => setModal({ kind: "action", transition: selectedTransition })}
            >
              Nova ação
            </button>
            <button
              className="module-builder__link"
              type="button"
              onClick={() => setModal({ kind: "transition", transition: selectedTransition })}
            >
              Editar
            </button>
            <button
              className="module-builder__link module-builder__link--danger"
              type="button"
              onClick={() => setModal({ kind: "remove-transition", transition: selectedTransition })}
            >
              Excluir
            </button>
          </div>
        </>
      );
    }

    return (
      <>
        <p className="module-builder__panel-kind">Nada selecionado</p>
        <p className="module-builder__hint">
          Clique numa situação para renomear ou excluir, ou numa seta para configurar o que ela
          preenche sozinha ao ser acionada.
        </p>
      </>
    );
  })();

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
        {/* Só no diagrama: com o textarea aberto, criar uma situação por modal
            recarregaria o workflow e o rascunho colado seria perdido. */}
        {view === "diagram" && (
          <button
            className="module-builder__btn module-builder__btn--small"
            type="button"
            onClick={() => setModal({ kind: "situation" })}
          >
            Nova situação
          </button>
        )}
      </div>

      {/* O mesmo alternador que a seção de campos usa, com o mesmo desenho: o
          diagrama continua sendo a alternativa visual, e o JSON é a de texto.
          Nenhum dos dois substitui o outro. */}
      <div className="module-builder__view-tabs">
        <button
          type="button"
          className={`module-builder__view-tab${
            view === "diagram" ? " module-builder__view-tab--on" : ""
          }`}
          onClick={() => setView("diagram")}
        >
          Diagrama
        </button>
        <button
          type="button"
          className={`module-builder__view-tab${
            view === "json" ? " module-builder__view-tab--on" : ""
          }`}
          onClick={() => setView("json")}
        >
          Ver como JSON
        </button>
      </div>

      {(error || actionError) && (
        <p className="module-builder__error">{actionError ?? error}</p>
      )}

      {view === "json" ? (
        <WorkflowJsonView
          key={moduleId}
          snapshot={snapshot}
          fields={fields}
          references={availableReferences}
          isFaciliteDeveloper={isFaciliteDeveloper}
          onApply={applyWorkflowPlan}
        />
      ) : situations.length === 0 ? (
        <p className="module-builder__empty">
          Este módulo ainda não tem situações. A primeira que você criar vira a situação inicial.
        </p>
      ) : (
        <WorkflowCanvas
          situations={situations}
          transitions={transitions}
          selection={selection}
          onSelect={setSelection}
          onMoveSituation={(id, x, y) => moveSituation(id, x, y)}
          onConnect={(from, to) => setModal({ kind: "transition", from, to })}
          panel={panel}
        />
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
          tone="danger"
          onConfirm={() =>
            run(async () => {
              await removeSituation(modal.situation.id);
              setSelection(null);
            })
          }
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
              : modal.from && modal.to
                ? {
                    id: null,
                    fromSituationId: modal.from,
                    toSituationId: modal.to,
                    label: "",
                    sortOrder: 0,
                  }
                : undefined
          }
          /* O par vem do diagrama nos dois casos: numa transição já criada ele
             é imutável, e numa nova ele é justamente o que os dois cliques
             acabaram de dizer. Editar por `<select>` aqui desfaria a ligação
             que a pessoa desenhou. */
          lockPair
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
          tone="danger"
          onConfirm={() =>
            run(async () => {
              await removeTransition(modal.transition.id);
              setSelection(null);
            })
          }
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
          tone="danger"
          onConfirm={() => run(() => removeAction(modal.action.id))}
          onCancel={() => setModal({ kind: "none" })}
        />
      )}
    </section>
  );
}

/**
 * Visão do workflow como JSON editável — a mesma ideia (e o mesmo desenho) da
 * aba "Ver como JSON" dos campos, aqui aplicada às situações, transições e
 * ações automáticas de uma vez.
 *
 * O diagrama é bom para *conferir* a máquina de estados e ruim para *montá-la*:
 * cada situação é um modal, cada seta são dois cliques, cada ação é outro
 * modal. Colar o documento inteiro resolve o módulo numa aplicação só — é o
 * caminho de quem opera a ferramenta e o de uma sessão do Claude Code, que lê
 * o estado exato sem inspecionar o desenho por screenshot/DOM.
 *
 * O texto é **estado próprio**, não uma projeção do workflow: editar não muda
 * nada até o "Aplicar". Quando o workflow muda de verdade (a aplicação
 * terminou), o texto é sincronizado de novo com o estado do banco — que é o
 * passo que mostra os ids reais do que acabou de ser criado.
 *
 * A validação é toda feita **antes** de qualquer escrita, nos três níveis, e a
 * primeira coisa errada aborta o documento inteiro: um workflow meio aplicado
 * é pior que um não aplicado, porque ninguém sabe onde ele parou.
 */
function WorkflowJsonView({
  snapshot,
  fields,
  references,
  isFaciliteDeveloper,
  onApply,
}: {
  snapshot: WorkflowSnapshot;
  fields: ModuleFieldDefinition[];
  references: ReferenceTarget[];
  isFaciliteDeveloper: boolean;
  onApply: (plan: WorkflowPlan) => Promise<string[]>;
}) {
  const json = useMemo(() => workflowToJson(snapshot), [snapshot]);
  const [text, setText] = useState(json);
  const seeded = useRef(json);
  const [copied, setCopied] = useState(false);
  const [applying, setApplying] = useState(false);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; message: string } | null>(null);

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
    const result = planWorkflowJson(text, snapshot, { fields, references, isFaciliteDeveloper });
    if (!result.ok) {
      setStatus({ tone: "error", message: result.error });
      return;
    }
    if (!workflowPlanHasWork(result.plan)) {
      setStatus({ tone: "ok", message: "Nada a aplicar: o documento já é igual ao do módulo." });
      return;
    }

    setApplying(true);
    try {
      const applied = await onApply(result.plan);
      setStatus({ tone: "ok", message: `Aplicado: ${applied.join("; ")}.` });
    } catch (err) {
      setStatus({
        tone: "error",
        message: extractErrorMessage(err, "Não foi possível aplicar o documento."),
      });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="module-builder__json-block">
      <div className="module-builder__json-toolbar">
        <p className="module-builder__json-hint">
          A ordem das listas vira a ordem das situações, transições e ações. Item sem <code>id</code>{" "}
          cria (o <code>code</code> de uma situação nova sai do nome); <code>id</code> que sumir
          remove. As transições apontam as situações pelo <code>code</code>, e as ações moram dentro
          da transição — assim uma situação e a seta que chega nela nascem na mesma aplicação. O
          código de uma situação que já existe não muda por aqui, a posição dos nós no diagrama não
          entra, e nada é gravado até "Aplicar".
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
