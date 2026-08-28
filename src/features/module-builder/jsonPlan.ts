/**
 * Peças compartilhadas entre a visão JSON dos **campos** (`fieldsJsonPlan.ts`)
 * e a do **workflow** (`workflowJsonPlan.ts`).
 *
 * As duas resolvem o mesmo problema — "esta é a lista que eu quero; descubra
 * sozinho o que virou edição, criação e remoção" — e resolviam-no com o mesmo
 * código escrito duas vezes. O que dá para compartilhar de verdade é o miolo
 * mecânico: parsear o texto, abortar tudo na primeira coisa errada, e casar
 * item da lista com linha do banco **por `id`**. O que *não* dá é a validação
 * de conteúdo: um campo tem `dataType` e chave física, uma situação tem código
 * e a marca de inicial, uma ação tem seis colunas que se exigem entre si. Cada
 * arquivo continua dono das suas regras e das suas mensagens.
 */

export type PlanResult<TPlan> = { ok: true; plan: TPlan } | { ok: false; error: string };

/** Erro de validação da lista — sempre com a mensagem já pronta para a tela. */
export class PlanError extends Error {}

export function fail(message: string): never {
  throw new PlanError(message);
}

export function describe(value: unknown): string {
  if (value === undefined) return "nada";
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return typeof value;
  }
}

/**
 * `JSON.parse` + a disciplina de tudo ou nada: qualquer `fail()` disparado lá
 * dentro vira `{ ok: false }` com a mensagem intacta, e **nada** é gravado.
 * Erro que não é de validação continua subindo — é bug, não lista ruim.
 */
export function parsePlan<TPlan>(text: string, build: (parsed: unknown) => TPlan): PlanResult<TPlan> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      ok: false,
      error: `JSON inválido: ${
        err instanceof Error ? err.message : "não foi possível interpretar o texto."
      }`,
    };
  }

  try {
    return { ok: true, plan: build(parsed) };
  } catch (err) {
    if (err instanceof PlanError) return { ok: false, error: err.message };
    throw err;
  }
}

export function readBoolean(
  item: Record<string, unknown>,
  key: string,
  at: string,
  fallback: boolean,
): boolean {
  const value = item[key];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") {
    fail(`${at}: “${key}” precisa ser true ou false (recebido: ${describe(value)}).`);
  }
  return value;
}

/** Texto obrigatório e não vazio, já aparado. */
export function readLabel(item: Record<string, unknown>, key: string, at: string): string {
  const value = item[key];
  if (typeof value !== "string" || !value.trim()) {
    fail(`${at}: “${key}” é obrigatório e precisa ser um texto não vazio.`);
  }
  return value.trim();
}

/** Texto opcional: `undefined`, `null` e `""` significam a mesma coisa — ausente. */
export function readOptionalText(
  item: Record<string, unknown>,
  key: string,
  at: string,
): string | null {
  const value = item[key];
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") {
    fail(`${at}: “${key}” precisa ser um texto ou null (recebido: ${describe(value)}).`);
  }
  return value;
}

/** Um item de lista já casado com a linha do banco, ou `null` quando é criação. */
export type IdReconcilerMessages = {
  invalidId: (at: string, value: unknown) => string;
  unknownId: (at: string, id: string) => string;
  repeatedId: (at: string, id: string) => string;
};

/**
 * O casamento por `id`, que é o que campos e workflow fazem igual: item com
 * `id` conhecido é edição, item sem `id` é criação, `id` que sumiu da lista é
 * remoção — e `id` inventado ou repetido é recusa.
 *
 * É **stateful de propósito**, chamado item a item de dentro do laço de
 * validação de quem usa, em vez de uma passada própria antes dele: assim a
 * primeira mensagem de erro continua sendo a do primeiro item problemático da
 * lista, e não "o id do item 7" quando o item 1 já estava sem rótulo.
 */
export function createIdReconciler<T extends { id: string }>(
  current: T[],
  messages: IdReconcilerMessages,
) {
  const byId = new Map(current.map((row) => [row.id, row]));
  const seen = new Set<string>();

  return {
    /** Lê o `id` do item e devolve a linha atual, ou `null` se é criação. */
    match(rawId: unknown, at: string): T | null {
      /* `id` vazio, nulo ou ausente significam a mesma coisa: item novo. */
      if (rawId === undefined || rawId === null || rawId === "") return null;
      if (typeof rawId !== "string") fail(messages.invalidId(at, rawId));

      const row = byId.get(rawId);
      if (!row) fail(messages.unknownId(at, rawId));
      if (seen.has(rawId)) fail(messages.repeatedId(at, rawId));
      seen.add(rawId);
      return row;
    },

    /** As linhas atuais que não apareceram na lista. */
    drops(): T[] {
      return current.filter((row) => !seen.has(row.id));
    },

    /** As linhas atuais que sobreviveram, na ordem em que estão hoje. */
    survivors(): T[] {
      return current.filter((row) => seen.has(row.id));
    },

    /** Se a ordem relativa dos sobreviventes na lista difere da atual. */
    orderChanged(listedIds: string[]): boolean {
      const survivors = current.filter((row) => seen.has(row.id)).map((row) => row.id);
      return survivors.some((id, index) => id !== listedIds[index]);
    },
  };
}
