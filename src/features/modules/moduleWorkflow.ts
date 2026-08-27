import { supabase } from "../../lib/supabaseClient";

/**
 * Workflow de um módulo de armazenamento genérico (M4): situações, transições
 * entre elas e as ações automáticas que cada transição dispara.
 *
 * Duas camadas moram aqui, e a diferença **não** é de tabela — é de quem pode
 * gravar cada forma de ação:
 *
 * - **Camada 1** (qualquer `can_manage_modules`): situações, transições, e
 *   ação que escreve no **próprio** registro (`self` + `literal`/`now`/
 *   `current_user`).
 * - **Camada 2** (só `profiles.is_facilite_developer`): ação que **lê** de um
 *   registro relacionado (`related_field`) ou **escreve** num registro
 *   relacionado (`related_record`), atravessando um campo de referência.
 *
 * O portão da Camada 2 está na RPC `save_module_transition_action`, não aqui:
 * esconder o controle na tela é conforto, não segurança.
 */

export type ModuleSituation = {
  id: string;
  moduleId: string;
  /** Estável e imutável — é o que fica gravado em `module_records.status`. */
  code: string;
  label: string;
  sortOrder: number;
  isInitial: boolean;
  /**
   * Posição no diagrama do construtor. Nuláveis: situação criada antes do
   * redesenho do construtor (ou por qualquer caminho que não seja o arraste)
   * não tem posição gravada, e o diagrama calcula uma em linha pela ordem de
   * `sort_order` em vez de recusar desenhar.
   */
  canvasX: number | null;
  canvasY: number | null;
};

export type ModuleTransition = {
  id: string;
  moduleId: string;
  fromSituationId: string;
  toSituationId: string;
  /** Texto do botão que o usuário do módulo vê (ex.: "Marcar como resolvido"). */
  label: string;
  sortOrder: number;
};

/** Onde a ação escreve: no próprio registro ou no registro relacionado. */
export type ActionTargetKind = "self" | "related_record";

/** De onde sai o valor gravado. */
export type ActionValueKind = "literal" | "now" | "current_user" | "related_field";

export type ModuleTransitionAction = {
  id: string;
  transitionId: string;
  sortOrder: number;
  targetKind: ActionTargetKind;
  targetFieldKey: string;
  /** Campo de referência do próprio módulo que a ação atravessa (Camada 2). */
  viaReferenceFieldKey: string | null;
  valueKind: ActionValueKind;
  value: string | null;
  /** Campo lido no registro relacionado (só em `related_field`). */
  sourceFieldKey: string | null;
};

/**
 * Uma ação é de Camada 2 quando atravessa uma referência — em qualquer das
 * duas direções. É a única coisa que consegue levar dado para outro módulo,
 * e por isso a única que exige desenvolvedor do Facilite para ser configurada.
 */
export function isCrossModuleAction(action: {
  targetKind: ActionTargetKind;
  valueKind: ActionValueKind;
}): boolean {
  return action.targetKind === "related_record" || action.valueKind === "related_field";
}

function assertSupabase() {
  if (!supabase) throw new Error("Supabase não está configurado.");
  return supabase;
}

export async function fetchModuleSituations(moduleId: string): Promise<ModuleSituation[]> {
  const { data, error } = await assertSupabase()
    .from("module_situations")
    .select("id, module_id, code, label, sort_order, is_initial, canvas_x, canvas_y")
    .eq("module_id", moduleId)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    moduleId: row.module_id,
    code: row.code,
    label: row.label,
    sortOrder: row.sort_order,
    isInitial: row.is_initial,
    canvasX: row.canvas_x,
    canvasY: row.canvas_y,
  }));
}

export async function fetchModuleTransitions(moduleId: string): Promise<ModuleTransition[]> {
  const { data, error } = await assertSupabase()
    .from("module_transitions")
    .select("id, module_id, from_situation_id, to_situation_id, label, sort_order")
    .eq("module_id", moduleId)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    moduleId: row.module_id,
    fromSituationId: row.from_situation_id,
    toSituationId: row.to_situation_id,
    label: row.label,
    sortOrder: row.sort_order,
  }));
}

export async function fetchTransitionActions(
  transitionIds: string[],
): Promise<ModuleTransitionAction[]> {
  if (transitionIds.length === 0) return [];

  const { data, error } = await assertSupabase()
    .from("module_transition_actions")
    .select(
      "id, transition_id, sort_order, target_kind, target_field_key, via_reference_field_key, value_kind, value, source_field_key",
    )
    .in("transition_id", transitionIds)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    transitionId: row.transition_id,
    sortOrder: row.sort_order,
    targetKind: row.target_kind as ActionTargetKind,
    targetFieldKey: row.target_field_key,
    viaReferenceFieldKey: row.via_reference_field_key,
    valueKind: row.value_kind as ActionValueKind,
    value: row.value,
    sourceFieldKey: row.source_field_key,
  }));
}

/* ------------------------------------------------------------------ *
 * Escrita — sempre RPC, nunca `insert`/`update` direto
 * ------------------------------------------------------------------ *
 * As três tabelas não têm policy de escrita nenhuma: quem grava é a RPC
 * `security definer`, que é onde moram as checagens que uma policy não
 * expressa (a situação é deste módulo? o campo de destino existe? quem está
 * gravando uma ação cruzada é desenvolvedor do Facilite?).
 */

export type SituationInput = {
  id?: string | null;
  label: string;
  sortOrder: number;
  isInitial: boolean;
};

export async function saveModuleSituation(
  moduleId: string,
  input: SituationInput,
): Promise<string> {
  const { data, error } = await assertSupabase().rpc("save_module_situation", {
    // Os tipos gerados marcam este parâmetro como `string` não-nulo, mas a RPC
    // aceita null (cria em vez de atualizar) — o gerador de tipos não capta
    // parâmetros opcionais/nuláveis do Postgres.
    p_id: (input.id ?? null) as string,
    p_module_id: moduleId,
    p_label: input.label,
    p_sort_order: input.sortOrder,
    p_is_initial: input.isInitial,
  });
  if (error) throw error;
  return data as string;
}

/**
 * Grava **só** a posição do nó no diagrama.
 *
 * RPC própria, e não `save_module_situation`, porque aquela não aceita patch
 * parcial: ela exige rótulo, ordem e `is_initial`, revalida o rótulo e mexe em
 * qual situação é a inicial. Arrastar uma caixa não deveria poder tocar em
 * nada disso — um arraste que reescreve `is_initial` seria um efeito colateral
 * invisível. O portão é o mesmo (`assert_module_workflow_editable`), então
 * nenhuma fronteira nova nasce aqui.
 */
export async function saveModuleSituationPosition(
  id: string,
  x: number,
  y: number,
): Promise<void> {
  const { error } = await assertSupabase().rpc("save_module_situation_position", {
    p_id: id,
    p_canvas_x: x,
    p_canvas_y: y,
  });
  if (error) throw error;
}

export async function deleteModuleSituation(id: string): Promise<void> {
  const { error } = await assertSupabase().rpc("delete_module_situation", { p_id: id });
  if (error) throw error;
}

export type TransitionInput = {
  id?: string | null;
  fromSituationId: string;
  toSituationId: string;
  label: string;
  sortOrder: number;
};

export async function saveModuleTransition(
  moduleId: string,
  input: TransitionInput,
): Promise<string> {
  const { data, error } = await assertSupabase().rpc("save_module_transition", {
    p_id: (input.id ?? null) as string,
    p_module_id: moduleId,
    p_from_situation_id: input.fromSituationId,
    p_to_situation_id: input.toSituationId,
    p_label: input.label,
    p_sort_order: input.sortOrder,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteModuleTransition(id: string): Promise<void> {
  const { error } = await assertSupabase().rpc("delete_module_transition", { p_id: id });
  if (error) throw error;
}

export type TransitionActionInput = {
  id?: string | null;
  targetKind: ActionTargetKind;
  targetFieldKey: string;
  viaReferenceFieldKey: string | null;
  valueKind: ActionValueKind;
  value: string | null;
  sourceFieldKey: string | null;
  sortOrder: number;
};

export async function saveTransitionAction(
  transitionId: string,
  input: TransitionActionInput,
): Promise<string> {
  const { data, error } = await assertSupabase().rpc("save_module_transition_action", {
    p_id: (input.id ?? null) as string,
    p_transition_id: transitionId,
    p_target_kind: input.targetKind,
    p_target_field_key: input.targetFieldKey,
    p_via_reference_field_key: input.viaReferenceFieldKey as string,
    p_value_kind: input.valueKind,
    p_value: input.value as string,
    p_source_field_key: input.sourceFieldKey as string,
    p_sort_order: input.sortOrder,
  });
  if (error) throw error;
  return data as string;
}

export async function deleteTransitionAction(id: string): Promise<void> {
  const { error } = await assertSupabase().rpc("delete_module_transition_action", { p_id: id });
  if (error) throw error;
}

/**
 * Executa a transição. Quem aciona precisa de `edit` no módulo **da
 * transição** e nada mais — se uma ação escrever noutro módulo, a permissão
 * que valeu foi a de quem configurou a automação, não a de quem apertou o
 * botão. Ver o comentário do modelo de confiança na RPC.
 */
export async function transitionModuleRecord(
  recordId: string,
  toSituationId: string,
): Promise<string> {
  const { data, error } = await assertSupabase().rpc("transition_module_record", {
    p_record_id: recordId,
    p_to_situation_id: toSituationId,
  });
  if (error) throw error;
  return data as string;
}
