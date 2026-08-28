import type { ModuleFieldDefinition } from "../registry-engine/types";
import {
  createIdReconciler,
  describe,
  fail,
  parsePlan,
  readBoolean,
  type PlanResult,
} from "./jsonPlan";
import {
  FIELD_TYPES,
  RESERVED_FIELD_KEYS,
  previewFieldKey,
  type NewModuleField,
} from "./moduleBuilder";

/**
 * Tradução do texto da visão JSON para o mesmo conjunto de escritas que o
 * canvas já faz (`addModuleField`/`updateModuleField`/`removeModuleField`/
 * `reorderModuleFields`). **Nenhum formato novo de payload nasce aqui** — este
 * arquivo só decide *quais* dessas chamadas fazer, comparando a lista colada
 * com a lista atual.
 *
 * A validação é toda feita antes de qualquer escrita, e a primeira coisa
 * errada aborta o plano inteiro: um módulo meio aplicado é pior que um módulo
 * não aplicado, porque ninguém sabe onde a lista parou.
 */

export type FieldsPlanOrderEntry =
  | { kind: "existing"; id: string }
  /** Posição de um campo que ainda não existe — o id real só aparece depois do insert. */
  | { kind: "new"; addIndex: number };

export type FieldsPlan = {
  edits: { id: string; label: string; patch: NewModuleField; changed: string[] }[];
  adds: { label: string; field: NewModuleField }[];
  drops: { id: string; label: string }[];
  /** A ordem final pedida pela lista, na ordem em que os itens aparecem nela. */
  order: FieldsPlanOrderEntry[];
  /** Se a ordem relativa dos campos que sobrevivem mudou. */
  orderChanged: boolean;
};

export type FieldsPlanResult = PlanResult<FieldsPlan>;

export type FieldsPlanOptions = {
  /** `false` em módulo de tabela dedicada: dá para editar campo, não criar nem remover. */
  allowStructuralChanges: boolean;
  /** Nome da tabela, só para a mensagem de recusa dizer o porquê. */
  storageLabel?: string | null;
};

const DATA_TYPE_VALUES = FIELD_TYPES.map((type) => type.value);

/** "Campo 3 (“Telefone”)" — a mensagem precisa dizer *qual* item da lista. */
function where(index: number, item: Record<string, unknown>): string {
  const label =
    typeof item.label === "string" && item.label.trim() ? ` (“${item.label.trim()}”)` : "";
  return `Campo ${index + 1}${label}`;
}

function changedProps(field: ModuleFieldDefinition, patch: NewModuleField): string[] {
  const changed: string[] = [];
  if (field.label.trim() !== patch.label) changed.push("label");
  if (field.dataType !== patch.dataType) changed.push("dataType");
  if (field.isRequired !== patch.isRequired) changed.push("isRequired");
  if (field.showInTable !== patch.showInTable) changed.push("showInTable");
  if (field.showInDetails !== patch.showInDetails) changed.push("showInDetails");
  if (field.showInForm !== patch.showInForm) changed.push("showInForm");
  if ((field.referenceModuleId ?? null) !== (patch.referenceModuleId ?? null)) {
    changed.push("referenceModuleId");
  }
  return changed;
}

export function planFieldsJson(
  text: string,
  current: ModuleFieldDefinition[],
  options: FieldsPlanOptions,
): FieldsPlanResult {
  return parsePlan(text, (parsed) => buildPlan(parsed, current, options));
}

function buildPlan(
  parsed: unknown,
  current: ModuleFieldDefinition[],
  options: FieldsPlanOptions,
): FieldsPlan {
  if (!Array.isArray(parsed)) {
    fail("O JSON precisa ser uma lista de campos (um array), igual à que o botão “Copiar” gera.");
  }

  /* O casamento por `id` — item conhecido vira edição, item sem `id` vira
     criação, `id` que sumiu vira remoção — é a mesma mecânica que a visão JSON
     do workflow usa; mora em `jsonPlan.ts`, com as mensagens vindo daqui. */
  const reconciler = createIdReconciler(current, {
    invalidId: (at, value) =>
      `${at}: “id” precisa ser o texto do id gravado, ou ser omitido para criar um campo novo (recebido: ${describe(value)}).`,
    unknownId: (at, id) =>
      `${at}: o “id” ${describe(id)} não é de nenhum campo deste módulo. Para criar um campo novo, deixe o item sem “id”.`,
    repeatedId: (at, id) => `${at}: o “id” ${describe(id)} aparece mais de uma vez na lista.`,
  });
  const edits: FieldsPlan["edits"] = [];
  const adds: FieldsPlan["adds"] = [];
  const order: FieldsPlanOrderEntry[] = [];

  parsed.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      fail(
        `Campo ${index + 1}: cada item da lista precisa ser um objeto (recebido: ${describe(raw)}).`,
      );
    }
    const item = raw as Record<string, unknown>;
    const at = where(index, item);

    const existing = reconciler.match(item.id, at);

    if (typeof item.label !== "string" || !item.label.trim()) {
      fail(`${at}: “label” é obrigatório e precisa ser um texto não vazio.`);
    }
    const label = item.label.trim();

    if (typeof item.dataType !== "string" || !DATA_TYPE_VALUES.includes(item.dataType as never)) {
      fail(
        `${at}: “dataType” precisa ser um destes: ${DATA_TYPE_VALUES.join(", ")} (recebido: ${describe(item.dataType)}).`,
      );
    }
    const dataType = item.dataType as ModuleFieldDefinition["dataType"];

    /* A chave física de um campo que já existe **não muda por aqui**, e a
       recusa é explícita em vez de silenciosa: aceitar e ignorar deixaria quem
       colou o JSON acreditando que renomeou a chave, enquanto o dado gravado
       continuaria debaixo da chave velha — o erro só apareceria muito depois,
       como valor sumido. Campo novo não traz chave nenhuma: ela é derivada do
       rótulo pela função do banco (`module_field_key`), como no canvas. */
    if (existing) {
      if (typeof item.fieldKey !== "string" || !item.fieldKey) {
        fail(
          `${at}: “fieldKey” é obrigatório em campo que já existe (é a chave física, e serve de conferência).`,
        );
      }
      if (item.fieldKey !== existing.fieldKey) {
        fail(
          `${at}: a chave de um campo que já existe não muda por esta via — o JSON traz “${item.fieldKey}” e no banco é “${existing.fieldKey}”. Mudar a chave orfanaria o dado já gravado. Devolva o valor original, ou remova este item e crie um campo novo.`,
        );
      }
      if (item.accessorKey !== undefined && item.accessorKey !== existing.accessorKey) {
        fail(
          `${at}: “accessorKey” é derivado de “fieldKey” e não muda por esta via (no banco é “${existing.accessorKey}”).`,
        );
      }
    }

    const isRequired = readBoolean(item, "isRequired", at, existing?.isRequired ?? false);
    const showInTable = readBoolean(item, "showInTable", at, existing?.showInTable ?? true);
    const showInDetails = readBoolean(item, "showInDetails", at, existing?.showInDetails ?? true);
    const showInForm = readBoolean(item, "showInForm", at, existing?.showInForm ?? true);
    if (!showInTable && !showInDetails && !showInForm) {
      fail(
        `${at}: o campo precisa aparecer em pelo menos um lugar — deixe “showInTable”, “showInDetails” ou “showInForm” como true.`,
      );
    }

    let referenceModuleId: string | null = null;
    const rawReference = item.referenceModuleId;
    if (rawReference !== undefined && rawReference !== null && rawReference !== "") {
      if (typeof rawReference !== "string") {
        fail(
          `${at}: “referenceModuleId” precisa ser o id de um módulo genérico, ou null (recebido: ${describe(rawReference)}).`,
        );
      }
      referenceModuleId = rawReference;
    }

    const patch: NewModuleField = {
      label,
      dataType,
      isRequired,
      showInTable,
      showInDetails,
      showInForm,
      referenceModuleId,
    };

    if (existing) {
      order.push({ kind: "existing", id: existing.id });
      const changed = changedProps(existing, patch);
      /* Campo que não mudou não é regravado — a lista inteira volta do
         "Copiar", então a maioria dos itens tipicamente está intacta. Quando há
         mudança o patch vai completo, porque `updateModuleField` grava todas as
         colunas de uma vez: mandar só o que mudou apagaria o resto. */
      if (changed.length) edits.push({ id: existing.id, label: existing.label, patch, changed });
      return;
    }

    order.push({ kind: "new", addIndex: adds.length });
    adds.push({ label, field: patch });
  });

  const drops = reconciler.drops().map((field) => ({ id: field.id, label: field.label }));

  /* Colisão de chave é checada aqui, e não no meio da gravação: `addModuleField`
     recusaria a chave reservada e o banco recusaria a duplicada, mas só depois
     de as escritas anteriores já terem passado. A chave de um campo removido
     nesta mesma aplicação está livre — as remoções são gravadas antes das
     criações justamente por isso. */
  const survivingKeys = new Set(reconciler.survivors().map((field) => field.fieldKey));
  const newKeys = new Set<string>();
  for (const add of adds) {
    const key = previewFieldKey(add.label);
    if (!key) {
      fail(
        `Campo novo “${add.label}”: o rótulo precisa ter pelo menos uma letra ou número — é dele que sai a chave física.`,
      );
    }
    if (RESERVED_FIELD_KEYS.includes(key)) {
      fail(`Campo novo “${add.label}”: o rótulo gera a chave reservada “${key}”. Use outro rótulo.`);
    }
    if (survivingKeys.has(key)) {
      fail(
        `Campo novo “${add.label}”: a chave “${key}” já é de um campo deste módulo. Use outro rótulo.`,
      );
    }
    if (newKeys.has(key)) {
      fail(
        `Campo novo “${add.label}”: dois itens novos gerariam a mesma chave “${key}”. Use rótulos diferentes.`,
      );
    }
    newKeys.add(key);
  }

  if (!options.allowStructuralChanges && (adds.length || drops.length)) {
    fail(
      `Este módulo só aceita ajustar campos que já existem${
        options.storageLabel ? ` (os dados moram na tabela ${options.storageLabel})` : ""
      } — a lista pede ${adds.length} campo(s) novo(s) e ${drops.length} removido(s), e isso exigiria mudar a tabela. Nada foi aplicado.`,
    );
  }

  const listedIds = order
    .filter((entry): entry is { kind: "existing"; id: string } => entry.kind === "existing")
    .map((entry) => entry.id);

  return { edits, adds, drops, order, orderChanged: reconciler.orderChanged(listedIds) };
}

export function planHasWork(plan: FieldsPlan): boolean {
  return Boolean(plan.edits.length || plan.adds.length || plan.drops.length || plan.orderChanged);
}

/**
 * Serializa um snapshot da lista de campos no **mesmo texto** que a visão
 * JSON aceita, para desfazer/refazer passar por `planFieldsJson` em vez de
 * ganhar um mecanismo próprio: "voltar ao estado anterior" é literalmente o
 * problema que esta reconciliação já resolve — comparar uma lista desejada
 * com a atual e decidir o que vira edição, criação, remoção e reordenação.
 *
 * A única tradução acontece no campo que **não existe mais** no banco: o
 * snapshot ainda carrega o `id` que ele tinha, e `planFieldsJson` recusaria um
 * id que não é de nenhum campo do módulo. Sem `id` (nem `fieldKey`, que só
 * serve de conferência em campo existente) o item vira criação — que é
 * exatamente o que desfazer uma remoção precisa. A chave sai de novo do
 * rótulo, e como `removeModuleField` nunca apagou o valor guardado no jsonb,
 * o campo recriado volta com os dados dos registros antigos: a mesma
 * reversibilidade que M3 já documentava, aqui usada de propósito.
 */
export function snapshotToFieldsJson(
  snapshot: ModuleFieldDefinition[],
  current: ModuleFieldDefinition[],
): string {
  const alive = new Set(current.map((field) => field.id));
  return JSON.stringify(
    snapshot.map((field) =>
      alive.has(field.id)
        ? field
        : {
            label: field.label,
            dataType: field.dataType,
            isRequired: field.isRequired,
            showInTable: field.showInTable,
            showInDetails: field.showInDetails,
            showInForm: field.showInForm,
            referenceModuleId: field.referenceModuleId ?? null,
          },
    ),
  );
}
