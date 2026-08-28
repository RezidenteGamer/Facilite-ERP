import type { ModuleFieldDefinition } from "../registry-engine/types";
import {
  isCrossModuleAction,
  type ActionTargetKind,
  type ActionValueKind,
  type ModuleSituation,
  type ModuleTransition,
  type ModuleTransitionAction,
  type SituationInput,
  type TransitionActionInput,
  type TransitionInput,
} from "../modules/moduleWorkflow";
import {
  createIdReconciler,
  describe,
  fail,
  parsePlan,
  readBoolean,
  readLabel,
  readOptionalText,
  type PlanResult,
} from "./jsonPlan";
import { previewFieldKey } from "./moduleBuilder";

/**
 * O mesmo que `fieldsJsonPlan.ts` faz para campos, aplicado ao workflow de
 * M4 — e pelo mesmo motivo. Um diagrama é bom para conferir a máquina de
 * estados e péssimo para *montá-la*: cada situação é um modal, cada seta são
 * dois cliques, cada ação automática é outro modal. Colar o workflow inteiro
 * de uma vez é o caminho de quem opera a ferramenta (a Facilite) e o de uma
 * sessão do Claude Code, que lê o estado exato sem inspecionar o desenho por
 * screenshot/DOM.
 *
 * **Nenhum payload novo nasce aqui.** Este arquivo só decide *quais* das
 * chamadas que o diagrama já fazia (`saveSituation`, `saveTransition`,
 * `saveAction`, `removeSituation`, `removeTransition`, `removeAction`) precisam
 * acontecer, comparando o documento colado com o estado atual. Quem executa é
 * `applyWorkflowPlan`, em `useModuleWorkflowBuilder.ts`.
 *
 * ## Por que o documento não é o dump cru das três listas
 *
 * A visão JSON dos campos mostra `ModuleFieldDefinition` sem tradução nenhuma,
 * e o ideal aqui seria o mesmo. Duas coisas impedem, e as duas são sobre
 * **referências entre as listas**:
 *
 * - **As ações são aninhadas dentro da transição**, em vez de um mapa
 *   `actionsByTransition` separado. Uma transição *nova* não tem id, então não
 *   tem chave sob a qual pendurar ações num mapa — aninhar é a única forma de
 *   criar uma transição e as ações dela na mesma aplicação.
 * - **A transição aponta as situações por `code`, não por `fromSituationId`**.
 *   Pelo mesmo motivo (uma situação nova ainda não tem id) e por um segundo:
 *   um par de uuids não diz nada a quem lê, e o `code` é justamente o
 *   identificador estável e legível que o banco já guarda em
 *   `module_records.status`. O `code` de uma situação nova é previsível — sai
 *   do rótulo pela mesma função que o formulário já mostra na dica.
 *
 * `id` continua sendo o que decide edição × criação, em todos os três níveis,
 * exatamente como nos campos.
 */

/** Um salto de referência do módulo, para validar as ações de Camada 2. */
export type WorkflowPlanReference = {
  fieldKey: string;
  fieldLabel: string;
  moduleLabel: string;
  fields: ModuleFieldDefinition[];
};

/** A transição de uma ação nova: já existe, ou é a n-ésima criada por este plano. */
export type TransitionRef = { kind: "existing"; id: string } | { kind: "new"; addIndex: number };

export type WorkflowPlan = {
  /* A ordem dos campos deste objeto é a ordem em que `applyWorkflowPlan`
     executa, e ela não é arbitrária — ver o comentário lá. */
  actionDrops: { id: string; label: string }[];
  transitionDrops: { id: string; label: string }[];
  situationDrops: { id: string; code: string; label: string }[];
  situationEdits: { id: string; label: string; input: SituationInput; changed: string[] }[];
  /** `code` é o apelido interno do plano: liga a situação criada às transições que a citam. */
  situationAdds: { code: string; label: string; input: SituationInput }[];
  /** Quem termina como situação inicial, quando não é quem já era. */
  promoteInitial: { code: string; label: string; sortOrder: number } | null;
  transitionEdits: { id: string; label: string; input: TransitionInput; changed: string[] }[];
  transitionAdds: { label: string; fromCode: string; toCode: string; sortOrder: number }[];
  actionEdits: {
    id: string;
    transitionId: string;
    label: string;
    input: TransitionActionInput;
    changed: string[];
  }[];
  actionAdds: { transition: TransitionRef; label: string; input: TransitionActionInput }[];
};

export type WorkflowPlanResult = PlanResult<WorkflowPlan>;

export type WorkflowPlanOptions = {
  /** Campos do próprio módulo — destino das ações de Camada 1. */
  fields: ModuleFieldDefinition[];
  /** Saltos de referência disponíveis. Vem vazio para quem não é desenvolvedor. */
  references: WorkflowPlanReference[];
  /** Libera as ações que atravessam uma referência (Camada 2). */
  isFaciliteDeveloper: boolean;
};

export type WorkflowSnapshot = {
  situations: ModuleSituation[];
  transitions: ModuleTransition[];
  actionsByTransition: Record<string, ModuleTransitionAction[]>;
};

const TARGET_KINDS: ActionTargetKind[] = ["self", "related_record"];
const VALUE_KINDS: ActionValueKind[] = ["literal", "now", "current_user", "related_field"];

/** Ordem de 10 em 10, para caber uma inserção manual entre duas sem renumerar tudo. */
function slot(index: number): number {
  return (index + 1) * 10;
}

function labelOf(item: Record<string, unknown>): string {
  return typeof item.label === "string" && item.label.trim() ? ` (“${item.label.trim()}”)` : "";
}

function asObject(raw: unknown, at: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(`${at}: precisa ser um objeto (recebido: ${describe(raw)}).`);
  }
  return raw as Record<string, unknown>;
}

function asArray(value: unknown, at: string, what: string): unknown[] {
  if (!Array.isArray(value)) {
    fail(`${at}: “${what}” precisa ser uma lista (recebido: ${describe(value)}).`);
  }
  return value;
}

/* ------------------------------------------------------------------ *
 * Leitura: o estado atual vira o texto que o "Copiar" entrega
 * ------------------------------------------------------------------ */

/**
 * Serializa o workflow no **mesmo formato** que `planWorkflowJson` aceita —
 * copiar, editar e aplicar precisa fechar o ciclo sem tradução no meio.
 *
 * Fica de fora, de propósito e dito na dica da tela: `sortOrder` (quem manda é
 * a posição na lista) e `canvasX`/`canvasY` (posição do nó no diagrama, que se
 * grava arrastando e não teria como ser conferida em texto).
 */
export function workflowToJson(snapshot: WorkflowSnapshot): string {
  const codeById = new Map(snapshot.situations.map((situation) => [situation.id, situation.code]));

  return JSON.stringify(
    {
      situations: snapshot.situations.map((situation) => ({
        id: situation.id,
        code: situation.code,
        label: situation.label,
        isInitial: situation.isInitial,
      })),
      transitions: snapshot.transitions.map((transition) => ({
        id: transition.id,
        label: transition.label,
        from: codeById.get(transition.fromSituationId) ?? null,
        to: codeById.get(transition.toSituationId) ?? null,
        actions: (snapshot.actionsByTransition[transition.id] ?? []).map((action) => ({
          id: action.id,
          targetKind: action.targetKind,
          targetFieldKey: action.targetFieldKey,
          viaReferenceFieldKey: action.viaReferenceFieldKey,
          valueKind: action.valueKind,
          value: action.value,
          sourceFieldKey: action.sourceFieldKey,
        })),
      })),
    },
    null,
    2,
  );
}

/* ------------------------------------------------------------------ *
 * Escrita: o texto vira o plano
 * ------------------------------------------------------------------ */

export function planWorkflowJson(
  text: string,
  snapshot: WorkflowSnapshot,
  options: WorkflowPlanOptions,
): WorkflowPlanResult {
  return parsePlan(text, (parsed) => buildPlan(parsed, snapshot, options));
}

function buildPlan(
  parsed: unknown,
  snapshot: WorkflowSnapshot,
  options: WorkflowPlanOptions,
): WorkflowPlan {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(
      "O JSON precisa ser um objeto com as listas “situations” e “transitions”, igual ao que o botão “Copiar” gera.",
    );
  }
  const document = parsed as Record<string, unknown>;
  const rawSituations = asArray(document.situations, "O JSON", "situations");
  const rawTransitions = asArray(document.transitions, "O JSON", "transitions");

  const situations = planSituations(rawSituations, snapshot);
  const transitions = planTransitions(rawTransitions, snapshot, situations, options);

  return { ...situations.plan, ...transitions };
}

/* ---- Situações ---------------------------------------------------- */

type SituationHandle = {
  code: string;
  label: string;
  isInitial: boolean;
  existing: ModuleSituation | null;
};

function planSituations(raw: unknown[], snapshot: WorkflowSnapshot) {
  const reconciler = createIdReconciler(snapshot.situations, {
    invalidId: (at, value) =>
      `${at}: “id” precisa ser o texto do id gravado, ou ser omitido para criar uma situação nova (recebido: ${describe(value)}).`,
    unknownId: (at, id) =>
      `${at}: o “id” ${describe(id)} não é de nenhuma situação deste módulo. Para criar uma situação nova, deixe o item sem “id”.`,
    repeatedId: (at, id) => `${at}: o “id” ${describe(id)} aparece mais de uma vez na lista.`,
  });

  const handles: SituationHandle[] = [];
  const listedIds: string[] = [];
  const seenCodes = new Set<string>();

  raw.forEach((rawItem, index) => {
    const item = asObject(rawItem, `Situação ${index + 1}`);
    const at = `Situação ${index + 1}${labelOf(item)}`;
    const existing = reconciler.match(item.id, at);
    const label = readLabel(item, "label", at);

    /* O `code` de uma situação que já existe **não muda por aqui**, mesma
       decisão (e mesmo motivo) da chave física de um campo: ele é o que está
       gravado em `module_records.status`, e trocá-lo orfanaria a situação de
       todo registro que já está nela. E a recusa é explícita em vez de
       silenciosa — aceitar e ignorar deixaria quem colou acreditando que
       renomeou o código. Em situação nova o `code` é opcional e ignorado: sai
       do rótulo, pela mesma função do banco. */
    let code: string;
    if (existing) {
      if (typeof item.code !== "string" || !item.code) {
        fail(
          `${at}: “code” é obrigatório em situação que já existe (é o que fica gravado nos registros, e serve de conferência).`,
        );
      }
      if (item.code !== existing.code) {
        fail(
          `${at}: o código de uma situação que já existe não muda por esta via — o JSON traz “${item.code}” e no banco é “${existing.code}”. Mudar o código orfanaria os registros que já estão nela. Devolva o valor original, ou remova este item e crie uma situação nova.`,
        );
      }
      code = existing.code;
      listedIds.push(existing.id);
    } else {
      code = previewFieldKey(label);
      if (!code) {
        fail(
          `${at}: o nome precisa ter pelo menos uma letra ou número — é dele que sai o código da situação.`,
        );
      }
    }

    if (seenCodes.has(code)) {
      fail(`${at}: o código “${code}” já é de outra situação da lista. Use outro nome.`);
    }
    seenCodes.add(code);

    const isInitial = readBoolean(item, "isInitial", at, existing?.isInitial ?? false);
    handles.push({ code, label, isInitial, existing });
  });

  /* Um módulo com workflow tem sempre **uma** inicial: sem ela o gatilho não
     conseguiria carimbar um registro novo, e com duas o índice único parcial
     do banco recusaria. Checar aqui evita descobrir isso no meio da gravação. */
  const initials = handles.filter((handle) => handle.isInitial);
  if (handles.length && initials.length !== 1) {
    fail(
      `A lista precisa ter exatamente uma situação com “isInitial”: true — é onde todo registro novo nasce (encontradas: ${initials.length}).`,
    );
  }

  const drops = reconciler.drops().map((situation) => ({
    id: situation.id,
    code: situation.code,
    label: situation.label,
  }));
  const orderChanged = reconciler.orderChanged(listedIds);
  const addCount = handles.filter((handle) => !handle.existing).length;
  /* Renumerar só quando a posição precisa mesmo ser expressa: renomear uma
     situação não deve reescrever a ordem de todas as outras. */
  const renumber = orderChanged || addCount > 0;

  const edits: WorkflowPlan["situationEdits"] = [];
  const adds: WorkflowPlan["situationAdds"] = [];
  /* A promoção da inicial é uma regravação completa (a RPC não aceita patch
     parcial), então ela precisa da ordem final que este laço acabou de decidir. */
  const sortOrderByCode = new Map<string, number>();

  handles.forEach((item, index) => {
    const sortOrder = renumber ? slot(index) : (item.existing?.sortOrder ?? slot(index));
    sortOrderByCode.set(item.code, sortOrder);

    if (!item.existing) {
      /* A marca de inicial nunca vai no create/update: ela é um passo próprio,
         no fim. Ver `promoteInitial`. */
      adds.push({
        code: item.code,
        label: item.label,
        input: { id: null, label: item.label, sortOrder, isInitial: false },
      });
      return;
    }

    const changed: string[] = [];
    if (item.existing.label !== item.label) changed.push("label");
    if (item.existing.sortOrder !== sortOrder) changed.push("ordem");
    if (!changed.length) return;

    edits.push({
      id: item.existing.id,
      label: item.existing.label,
      /* `isInitial` vai com o valor **atual**, não com o pedido: a RPC recusa
         desmarcar a inicial vigente, e mandar o valor pedido aqui quebraria
         qualquer troca de inicial que dependesse da ordem dos itens. */
      input: { id: item.existing.id, label: item.label, sortOrder, isInitial: item.existing.isInitial },
      changed,
    });
  });

  /* A troca da inicial é uma chamada só, depois de todo o resto: assim ela
     funciona igual quando a nova inicial é uma situação que já existia, uma
     criada nesta mesma aplicação, ou quando a antiga acabou de ser removida —
     sem depender da ordem em que os itens aparecem na lista. A própria RPC
     desmarca a anterior. */
  const desiredInitial = initials[0] ?? null;
  const currentInitial = snapshot.situations.find((situation) => situation.isInitial) ?? null;
  const promoteInitial =
    desiredInitial && (desiredInitial.existing?.id ?? null) !== (currentInitial?.id ?? null)
      ? {
          code: desiredInitial.code,
          label: desiredInitial.label,
          sortOrder: sortOrderByCode.get(desiredInitial.code) ?? 0,
        }
      : null;

  return {
    handles,
    plan: {
      situationDrops: drops,
      situationEdits: edits,
      situationAdds: adds,
      promoteInitial,
    },
  };
}

/* ---- Transições e ações ------------------------------------------- */

function planTransitions(
  raw: unknown[],
  snapshot: WorkflowSnapshot,
  situations: ReturnType<typeof planSituations>,
  options: WorkflowPlanOptions,
) {
  const situationByCode = new Map(situations.handles.map((handle) => [handle.code, handle]));
  const currentSituationById = new Map(
    snapshot.situations.map((situation) => [situation.id, situation]),
  );

  const reconciler = createIdReconciler(snapshot.transitions, {
    invalidId: (at, value) =>
      `${at}: “id” precisa ser o texto do id gravado, ou ser omitido para criar uma transição nova (recebido: ${describe(value)}).`,
    unknownId: (at, id) =>
      `${at}: o “id” ${describe(id)} não é de nenhuma transição deste módulo. Para criar uma transição nova, deixe o item sem “id”.`,
    repeatedId: (at, id) => `${at}: o “id” ${describe(id)} aparece mais de uma vez na lista.`,
  });

  const currentActions = snapshot.transitions.flatMap(
    (transition) => snapshot.actionsByTransition[transition.id] ?? [],
  );
  const actionReconciler = createIdReconciler(currentActions, {
    invalidId: (at, value) =>
      `${at}: “id” precisa ser o texto do id gravado, ou ser omitido para criar uma ação nova (recebido: ${describe(value)}).`,
    unknownId: (at, id) =>
      `${at}: o “id” ${describe(id)} não é de nenhuma ação deste módulo. Para criar uma ação nova, deixe o item sem “id”.`,
    repeatedId: (at, id) => `${at}: o “id” ${describe(id)} aparece mais de uma vez na lista.`,
  });

  const listedIds: string[] = [];
  const parsedItems: {
    existing: ModuleTransition | null;
    label: string;
    fromCode: string;
    toCode: string;
    at: string;
    rawActions: unknown[];
  }[] = [];
  const seenPairs = new Set<string>();

  raw.forEach((rawItem, index) => {
    const item = asObject(rawItem, `Transição ${index + 1}`);
    const at = `Transição ${index + 1}${labelOf(item)}`;
    const existing = reconciler.match(item.id, at);
    const label = readLabel(item, "label", at);
    const fromCode = readLabel(item, "from", at);
    const toCode = readLabel(item, "to", at);

    if (fromCode === toCode) {
      fail(`${at}: a transição precisa ir de uma situação para outra — “from” e “to” são iguais.`);
    }
    for (const [key, code] of [
      ["from", fromCode],
      ["to", toCode],
    ] as const) {
      if (!situationByCode.has(code)) {
        fail(
          `${at}: “${key}” aponta para o código “${code}”, que não está na lista de situações. Use o “code” de uma das situações do documento.`,
        );
      }
    }

    /* O par de uma transição que já existe é imutável no banco (mudá-lo
       viraria o sentido das ações penduradas nela sem que elas soubessem), e
       a RPC simplesmente ignora os parâmetros na edição. Ignorar em silêncio
       aqui deixaria quem colou acreditando que redesenhou a seta. */
    if (existing) {
      const currentFrom = currentSituationById.get(existing.fromSituationId)?.code ?? "?";
      const currentTo = currentSituationById.get(existing.toSituationId)?.code ?? "?";
      if (fromCode !== currentFrom || toCode !== currentTo) {
        fail(
          `${at}: o caminho de uma transição que já existe não muda por esta via — o JSON traz “${fromCode}” → “${toCode}” e no banco é “${currentFrom}” → “${currentTo}”. As ações configuradas nela mudariam de sentido em silêncio. Remova este item e crie uma transição nova.`,
        );
      }
      listedIds.push(existing.id);
    }

    const pair = `${fromCode}→${toCode}`;
    if (seenPairs.has(pair)) {
      fail(`${at}: já existe outra transição de “${fromCode}” para “${toCode}” na lista.`);
    }
    seenPairs.add(pair);

    const rawActions = item.actions === undefined ? [] : asArray(item.actions, at, "actions");
    parsedItems.push({ existing: existing ?? null, label, fromCode, toCode, at, rawActions });
  });

  const drops = reconciler.drops().map((transition) => ({
    id: transition.id,
    label: transition.label,
  }));
  const addCount = parsedItems.filter((item) => !item.existing).length;
  const renumber = reconciler.orderChanged(listedIds) || addCount > 0;

  const edits: WorkflowPlan["transitionEdits"] = [];
  const adds: WorkflowPlan["transitionAdds"] = [];
  const actionEdits: WorkflowPlan["actionEdits"] = [];
  const actionAdds: WorkflowPlan["actionAdds"] = [];

  parsedItems.forEach((item, index) => {
    const sortOrder = renumber ? slot(index) : (item.existing?.sortOrder ?? slot(index));
    let transitionRef: TransitionRef;

    if (item.existing) {
      transitionRef = { kind: "existing", id: item.existing.id };
      const changed: string[] = [];
      if (item.existing.label !== item.label) changed.push("label");
      if (item.existing.sortOrder !== sortOrder) changed.push("ordem");
      if (changed.length) {
        edits.push({
          id: item.existing.id,
          label: item.existing.label,
          input: {
            id: item.existing.id,
            fromSituationId: item.existing.fromSituationId,
            toSituationId: item.existing.toSituationId,
            label: item.label,
            sortOrder,
          },
          changed,
        });
      }
    } else {
      transitionRef = { kind: "new", addIndex: adds.length };
      adds.push({ label: item.label, fromCode: item.fromCode, toCode: item.toCode, sortOrder });
    }

    planActions({
      item,
      transitionRef,
      snapshot,
      options,
      actionReconciler,
      actionEdits,
      actionAdds,
    });
  });

  /* Ação removida some antes da transição que a carrega e antes da situação que
     a transição usa — desfazer automação nunca quebra nada, e o banco recusa
     apagar uma situação que ainda tem transição. */
  const actionDrops = actionReconciler.drops().map((action) => {
    const transition = snapshot.transitions.find((row) => row.id === action.transitionId);
    return {
      id: action.id,
      label: `ação de “${transition?.label ?? "?"}” que preenche “${action.targetFieldKey}”`,
    };
  });

  return {
    actionDrops,
    transitionDrops: drops,
    transitionEdits: edits,
    transitionAdds: adds,
    actionEdits,
    actionAdds,
  };
}

function planActions({
  item,
  transitionRef,
  snapshot,
  options,
  actionReconciler,
  actionEdits,
  actionAdds,
}: {
  item: { existing: ModuleTransition | null; label: string; at: string; rawActions: unknown[] };
  transitionRef: TransitionRef;
  snapshot: WorkflowSnapshot;
  options: WorkflowPlanOptions;
  actionReconciler: ReturnType<typeof createIdReconciler<ModuleTransitionAction>>;
  actionEdits: WorkflowPlan["actionEdits"];
  actionAdds: WorkflowPlan["actionAdds"];
}) {
  const currentActions = item.existing ? (snapshot.actionsByTransition[item.existing.id] ?? []) : [];
  const parsedItems: { existing: ModuleTransitionAction | null; input: TransitionActionInput }[] =
    [];
  const listedIds: string[] = [];

  item.rawActions.forEach((rawAction, index) => {
    const at = `Ação ${index + 1} de “${item.label}”`;
    const action = asObject(rawAction, at);
    const existing = actionReconciler.match(action.id, at);

    /* Uma ação não muda de transição por esta via: `save_module_transition_action`
       filtra o update por `(id, transition_id)` e responderia "ação não
       encontrada" — mensagem verdadeira e inútil. */
    if (existing && existing.transitionId !== item.existing?.id) {
      const owner = snapshot.transitions.find((row) => row.id === existing.transitionId);
      fail(
        `${at}: esta ação é da transição “${owner?.label ?? "?"}” e não muda de transição por esta via. Remova o “id” para criar uma cópia aqui, ou devolva a ação para a transição de origem.`,
      );
    }
    if (existing) listedIds.push(existing.id);

    parsedItems.push({ existing, input: readAction(action, at, options) });
  });

  const addCount = parsedItems.filter((entry) => !entry.existing).length;
  const survivorOrder = currentActions.filter((action) => listedIds.includes(action.id));
  const renumber = addCount > 0 || survivorOrder.some((action, i) => action.id !== listedIds[i]);

  parsedItems.forEach((entry, index) => {
    const sortOrder = renumber ? slot(index) : (entry.existing?.sortOrder ?? slot(index));
    const input = { ...entry.input, sortOrder };
    const label = `${describeTarget(input)} em “${item.label}”`;

    if (!entry.existing) {
      actionAdds.push({ transition: transitionRef, label, input });
      return;
    }

    const changed = changedActionProps(entry.existing, input);
    if (!changed.length) return;
    actionEdits.push({
      id: entry.existing.id,
      transitionId: entry.existing.transitionId,
      label,
      input: { ...input, id: entry.existing.id },
      changed,
    });
  });
}

function describeTarget(input: TransitionActionInput): string {
  return input.targetKind === "related_record"
    ? `ação que preenche “${input.targetFieldKey}” no módulo relacionado`
    : `ação que preenche “${input.targetFieldKey}”`;
}

function changedActionProps(
  current: ModuleTransitionAction,
  input: TransitionActionInput,
): string[] {
  const changed: string[] = [];
  if (current.targetKind !== input.targetKind) changed.push("targetKind");
  if (current.targetFieldKey !== input.targetFieldKey) changed.push("targetFieldKey");
  if (current.viaReferenceFieldKey !== input.viaReferenceFieldKey) {
    changed.push("viaReferenceFieldKey");
  }
  if (current.valueKind !== input.valueKind) changed.push("valueKind");
  if ((current.value ?? null) !== (input.value ?? null)) changed.push("value");
  if ((current.sourceFieldKey ?? null) !== (input.sourceFieldKey ?? null)) {
    changed.push("sourceFieldKey");
  }
  if (current.sortOrder !== input.sortOrder) changed.push("ordem");
  return changed;
}

/**
 * As seis colunas de uma ação se exigem entre si, e as regras são exatamente
 * os CHECK da tabela: `viaReferenceFieldKey` existe **quando** a ação atravessa
 * uma referência, `sourceFieldKey` **quando** o valor vem do relacionado,
 * `value` **quando** o valor é literal — e `related_record` + `related_field`
 * na mesma linha é proibido (exigiria duas colunas `via`).
 *
 * Tudo é conferido aqui, antes de qualquer escrita, porque descobrir isso na
 * terceira ação de uma transição no meio da aplicação deixaria um workflow
 * meio montado.
 */
function readAction(
  action: Record<string, unknown>,
  at: string,
  options: WorkflowPlanOptions,
): TransitionActionInput {
  const rawTarget = action.targetKind ?? "self";
  if (typeof rawTarget !== "string" || !TARGET_KINDS.includes(rawTarget as ActionTargetKind)) {
    fail(
      `${at}: “targetKind” precisa ser um destes: ${TARGET_KINDS.join(", ")} (recebido: ${describe(action.targetKind)}).`,
    );
  }
  const targetKind = rawTarget as ActionTargetKind;

  const rawValueKind = action.valueKind;
  if (typeof rawValueKind !== "string" || !VALUE_KINDS.includes(rawValueKind as ActionValueKind)) {
    fail(
      `${at}: “valueKind” precisa ser um destes: ${VALUE_KINDS.join(", ")} (recebido: ${describe(rawValueKind)}).`,
    );
  }
  const valueKind = rawValueKind as ActionValueKind;

  if (targetKind === "related_record" && valueKind === "related_field") {
    fail(
      `${at}: uma ação não pode ao mesmo tempo ler de outro módulo e escrever em outro módulo — seria preciso atravessar duas referências, e só um salto é suportado. Divida em duas ações.`,
    );
  }

  /* Camada 2 escondida, não desabilitada — o mesmo portão que a RPC impõe.
     Recusar aqui é o que mantém "tudo ou nada": sem isto, a lista começaria a
     ser gravada e pararia na primeira ação cruzada. */
  const crossModule = isCrossModuleAction({ targetKind, valueKind });
  if (crossModule && !options.isFaciliteDeveloper) {
    fail(
      `${at}: ação que lê ou escreve em outro módulo só pode ser configurada por um desenvolvedor do Facilite.`,
    );
  }

  const targetFieldKey = readLabel(action, "targetFieldKey", at);
  const via = readOptionalText(action, "viaReferenceFieldKey", at);
  const source = readOptionalText(action, "sourceFieldKey", at);

  if (crossModule && !via) {
    fail(
      `${at}: “viaReferenceFieldKey” é obrigatório quando a ação atravessa uma referência — é o campo deste módulo que leva até o registro do outro.`,
    );
  }
  if (!crossModule && via) {
    fail(
      `${at}: “viaReferenceFieldKey” só existe em ação que atravessa uma referência. Deixe null.`,
    );
  }
  if (valueKind === "related_field" && !source) {
    fail(`${at}: “sourceFieldKey” é obrigatório quando o valor vem de um campo do relacionado.`);
  }
  if (valueKind !== "related_field" && source) {
    fail(`${at}: “sourceFieldKey” só existe quando “valueKind” é related_field. Deixe null.`);
  }

  let value: string | null = null;
  if (valueKind === "literal") {
    if (typeof action.value !== "string") {
      fail(
        `${at}: “value” é obrigatório e precisa ser texto quando “valueKind” é literal (recebido: ${describe(action.value)}).`,
      );
    }
    value = action.value;
  } else if (action.value !== undefined && action.value !== null) {
    fail(
      `${at}: “value” só existe quando “valueKind” é literal — em ${valueKind} o valor é calculado. Deixe null.`,
    );
  }

  const reference = via ? options.references.find((item) => item.fieldKey === via) : null;
  if (via && !reference) {
    const known = options.references.map((item) => `“${item.fieldKey}”`).join(", ");
    fail(
      `${at}: “${via}” não é um campo de referência deste módulo${
        known ? ` — os que existem são: ${known}` : " (o módulo não tem nenhum campo apontando para outro módulo)"
      }.`,
    );
  }

  /* Existência do campo de destino/origem: a RPC também confere, mas descobrir
     por lá custaria uma gravação parcial. O módulo do outro lado só é
     conferível quando a referência veio carregada — que é exatamente quando a
     Camada 2 está liberada. */
  const targetFields = targetKind === "related_record" ? (reference?.fields ?? []) : options.fields;
  const targetModule = targetKind === "related_record" ? (reference?.moduleLabel ?? "") : "";
  const targetField = targetFields.find((field) => field.fieldKey === targetFieldKey);
  if (!targetField) {
    fail(
      `${at}: o campo de destino “${targetFieldKey}” não existe${targetModule ? ` em ${targetModule}` : " neste módulo"}.`,
    );
  }
  if (targetField.referenceModuleId) {
    fail(
      `${at}: “${targetFieldKey}” aponta para outro módulo e não pode ser preenchido por uma ação — gravar por cima quebraria o apontamento que as outras ações usam.`,
    );
  }
  if (source && reference && !reference.fields.some((field) => field.fieldKey === source)) {
    fail(`${at}: o campo de origem “${source}” não existe em ${reference.moduleLabel}.`);
  }

  return {
    id: null,
    targetKind,
    targetFieldKey,
    viaReferenceFieldKey: via,
    valueKind,
    value,
    sourceFieldKey: source,
    sortOrder: 0,
  };
}

export function workflowPlanHasWork(plan: WorkflowPlan): boolean {
  return Boolean(
    plan.actionDrops.length ||
      plan.transitionDrops.length ||
      plan.situationDrops.length ||
      plan.situationEdits.length ||
      plan.situationAdds.length ||
      plan.promoteInitial ||
      plan.transitionEdits.length ||
      plan.transitionAdds.length ||
      plan.actionEdits.length ||
      plan.actionAdds.length,
  );
}
