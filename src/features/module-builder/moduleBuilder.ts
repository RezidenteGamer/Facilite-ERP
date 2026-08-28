import { supabase } from "../../lib/supabaseClient";
import type { ModuleFieldDefinition, ModuleStorageKind } from "../registry-engine/types";
import { MODULE_COMPONENTS } from "../modules/moduleComponents";

/**
 * Uma linha de `modules` como o construtor precisa vê-la — mais crua que a
 * `CatalogModule` do roteador, porque aqui interessa também o que a tela
 * inicial não usa (`data_table`, `is_locked`, `storage_kind`).
 */
export type BuilderModule = {
  id: string;
  label: string;
  path: string | null;
  sortOrder: number;
  branchScoped: boolean;
  /** `false` = criado pelo usuário; `true` = módulo de sistema (M2 reaproveitou esta coluna). */
  isLocked: boolean;
  storageKind: ModuleStorageKind;
  dataTable: string | null;
  accessGate: string;
};

/**
 * Os tipos que o motor genérico **já** suporta. O construtor escolhe entre os
 * que existem e não inventa nenhum tipo novo — criar um `data_type` novo
 * (opções, número, arquivo) seria generalizar o motor inteiro por causa de um
 * formulário. Quem desenha a escolha é `FieldTypePicker` (cinco ícones lado a
 * lado, no lugar do `<select>` que existia até o redesenho do construtor);
 * esta lista continua sendo a única fonte de quais tipos existem.
 *
 * Nota honesta sobre o que cada um faz hoje: só `date` muda o `<input>` (para
 * `type="date"`). `boolean`, `phone` e `email` são texto na tela — é o
 * comportamento que Clientes e Produtos já tinham antes desta etapa, e mudar
 * isso seria mexer no motor, não no construtor.
 */
export const FIELD_TYPES: { value: ModuleFieldDefinition["dataType"]; label: string }[] = [
  { value: "text", label: "Texto" },
  { value: "date", label: "Data" },
  { value: "email", label: "E-mail" },
  { value: "phone", label: "Telefone" },
  { value: "boolean", label: "Sim/Não" },
];

/** Chaves que são coluna real de `module_records` e por isso não podem virar campo. */
export const RESERVED_FIELD_KEYS = [
  "id",
  "module_id",
  "branch_id",
  "data",
  "created_at",
  "updated_at",
  "created_by",
];

/**
 * Espelho em TypeScript da função `public.module_field_key` do banco, usada
 * **só para o preview** que a tela mostra enquanto o usuário digita o rótulo.
 * Quem gera a chave que vai para o banco é sempre a função SQL (na criação do
 * módulo, por dentro de `create_user_module`; ao adicionar um campo depois,
 * pela RPC `module_field_key`) — assim não existe a chance de o preview e o
 * dado gravado discordarem por causa de uma diferença de implementação.
 */
export function previewFieldKey(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) return "";
  return /^[0-9]/.test(slug) ? `campo_${slug}` : slug;
}

/** Espelho de `public.slugify_text`, para prever o id/rota do módulo novo. */
export function previewModuleId(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Por que um módulo aceita (ou não) o construtor de campos.
 *
 * O limite real desta etapa mora aqui. Um módulo com **tela própria**
 * (`ProductsPage.tsx` lê `product.ncm`, não um campo dinâmico) não olha para
 * `module_fields` — adicionar uma linha lá não apareceria em lugar nenhum.
 * Fazer isso funcionar exigiria tocar em cada tela escrita à mão do sistema,
 * que é escopo muito maior do que M1 ou M3 pediram. Então o construtor
 * **recusa explicitamente**, em vez de aceitar e não mostrar nada.
 */
export type FieldEditingCapability =
  | { kind: "full"; reason?: undefined }
  | { kind: "existing-only"; reason: string }
  | { kind: "none"; reason: string };

export function fieldEditingCapabilityFor(module: BuilderModule): FieldEditingCapability {
  if (MODULE_COMPONENTS[module.id]) {
    return {
      kind: "none",
      reason:
        "Este módulo tem tela própria; campos personalizados só funcionam em módulos sem tela própria.",
    };
  }

  if (module.storageKind === "generic") return { kind: "full" };

  if (!module.dataTable) {
    return {
      kind: "none",
      reason:
        "Este módulo não tem tabela de dados (modules.data_table) — não há onde guardar o valor de um campo.",
    };
  }

  /* Um módulo `table` sem tela própria (Tributações, Grupos tributários) roda
     na GenericModulePage e lê tudo de `module_fields`, então editar rótulo,
     obrigatoriedade e onde o campo aparece funciona de verdade. Criar um campo
     novo, não: a coluna precisaria existir na tabela dedicada, e este projeto
     não dispara DDL a partir da tela. Quem tolera chave nova sem migration é
     só o armazenamento jsonb. */
  return {
    kind: "existing-only",
    reason: `Este módulo guarda os dados na tabela ${module.dataTable}. Dá para ajustar os campos que já existem, mas criar ou remover campo exigiria mudar a tabela — só módulos de armazenamento genérico aceitam campo novo.`,
  };
}

function assertSupabase() {
  if (!supabase) throw new Error("Supabase não está configurado.");
  return supabase;
}

export type NewModuleField = {
  label: string;
  dataType: ModuleFieldDefinition["dataType"];
  isRequired: boolean;
  showInTable: boolean;
  showInDetails: boolean;
  showInForm: boolean;
  /**
   * Módulo genérico apontado por este campo, ou `null` para campo comum.
   *
   * Só um desenvolvedor do Facilite consegue gravar isto — e a recusa vem do
   * banco (trigger `module_fields_guard_reference`), não da tela. O motivo de
   * a checagem morar num trigger e não numa RPC nova: `module_fields` já
   * aceita `can_manage_modules()` gravando direto pelo PostgREST desde M3, e
   * uma RPC protegeria só o caminho novo.
   */
  referenceModuleId?: string | null;
};

export type NewModuleInput = {
  label: string;
  branchScoped: boolean;
  sortOrder: number;
  fields: NewModuleField[];
};

export async function fetchBuilderModules(): Promise<BuilderModule[]> {
  const { data, error } = await assertSupabase()
    .from("modules")
    .select("id, label, path, sort_order, branch_scoped, is_locked, storage_kind, data_table, access_gate")
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    label: row.label,
    path: row.path,
    sortOrder: row.sort_order,
    branchScoped: row.branch_scoped,
    isLocked: row.is_locked,
    storageKind: row.storage_kind === "generic" ? "generic" : "table",
    dataTable: row.data_table,
    accessGate: row.access_gate,
  }));
}

export async function fetchModuleFields(moduleId: string): Promise<ModuleFieldDefinition[]> {
  const { data, error } = await assertSupabase()
    .from("module_fields")
    .select("*")
    .eq("module_id", moduleId)
    .order("sort_order", { ascending: true });
  if (error) throw error;

  return (data ?? []).map((field) => ({
    id: field.id,
    fieldKey: field.field_key,
    accessorKey: field.field_key.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase()),
    label: field.label,
    dataType: field.data_type as ModuleFieldDefinition["dataType"],
    isRequired: field.is_required,
    sortOrder: field.sort_order,
    showInTable: field.show_in_table,
    tableWidth: field.table_width,
    tableAlign: (field.table_align as ModuleFieldDefinition["tableAlign"]) ?? "left",
    showInDetails: field.show_in_details,
    showInForm: field.show_in_form,
    referenceModuleId: field.reference_module_id,
  }));
}

/**
 * Cria o módulo inteiro (linha em `modules` + campos + a concessão de
 * permissão para o papel de quem criou) numa transação só, do lado do banco.
 * Ver o comentário de `create_user_module` na migration: o último passo é o
 * motivo de isto ser RPC e não `insert`.
 */
export async function createUserModule(input: NewModuleInput): Promise<string> {
  const { data, error } = await assertSupabase().rpc("create_user_module", {
    p_label: input.label,
    p_branch_scoped: input.branchScoped,
    p_sort_order: input.sortOrder,
    p_fields: input.fields.map((field) => ({
      label: field.label,
      data_type: field.dataType,
      is_required: field.isRequired,
      show_in_table: field.showInTable,
      show_in_details: field.showInDetails,
      show_in_form: field.showInForm,
    })),
  });
  if (error) throw error;
  return data as string;
}

export async function deleteUserModule(moduleId: string): Promise<void> {
  const { error } = await assertSupabase().rpc("delete_user_module", { p_module_id: moduleId });
  if (error) throw error;
}

/**
 * Devolve o `id` da linha criada — o cliente não tem como adivinhá-lo, e quem
 * aplica uma lista inteira de campos (a visão JSON) precisa dele para montar a
 * ordem final com ids reais depois das criações.
 */
export async function addModuleField(moduleId: string, field: NewModuleField): Promise<string> {
  const client = assertSupabase();

  // A chave vem da mesma função SQL que `create_user_module` usa — o preview
  // da tela é só preview.
  const { data: key, error: keyError } = await client.rpc("module_field_key", {
    p_label: field.label,
  });
  if (keyError) throw keyError;
  if (!key) throw new Error("O rótulo do campo precisa ter pelo menos uma letra ou número.");
  if (RESERVED_FIELD_KEYS.includes(key as string)) {
    throw new Error(`O rótulo "${field.label}" gera a chave reservada "${key}". Use outro rótulo.`);
  }

  const { data: last, error: lastError } = await client
    .from("module_fields")
    .select("sort_order")
    .eq("module_id", moduleId)
    .order("sort_order", { ascending: false })
    .limit(1);
  if (lastError) throw lastError;

  const { data: created, error } = await client
    .from("module_fields")
    .insert({
      module_id: moduleId,
      field_key: key as string,
      label: field.label.trim(),
      data_type: field.dataType,
      is_required: field.isRequired,
      sort_order: (last?.[0]?.sort_order ?? 0) + 10,
      show_in_table: field.showInTable,
      show_in_details: field.showInDetails,
      show_in_form: field.showInForm,
      reference_module_id: field.referenceModuleId ?? null,
    })
    .select("id")
    .single();
  if (error) throw error;
  return created.id as string;
}

/**
 * `field_key` **não** entra no patch, nunca. Mudar a chave depois de já
 * existirem registros gravados orfanaria o dado antigo debaixo da chave velha
 * — o mesmo motivo pelo qual não se renomeia coluna de banco em produção.
 */
export async function updateModuleField(
  fieldId: string,
  patch: NewModuleField,
): Promise<void> {
  const { error } = await assertSupabase()
    .from("module_fields")
    .update({
      label: patch.label.trim(),
      data_type: patch.dataType,
      is_required: patch.isRequired,
      show_in_table: patch.showInTable,
      show_in_details: patch.showInDetails,
      show_in_form: patch.showInForm,
      reference_module_id: patch.referenceModuleId ?? null,
    })
    .eq("id", fieldId);
  if (error) throw error;
}

/**
 * Grava a ordem nova dos campos depois de um arraste no canvas.
 *
 * **Sem RPC nova**: `module_fields` já aceita `update` direto pelo PostgREST
 * de quem tem `can_manage_modules` (policy de M3, confirmada antes de
 * escrever isto), e `sort_order` é uma coluna comum dessa tabela — a mesma
 * que `updateModuleField` já mexeria se o formulário a oferecesse. Uma RPC de
 * reordenação em lote só existiria para economizar viagens de rede numa lista
 * de meia dúzia de linhas.
 *
 * Só os campos que **mudaram** de posição são gravados: reordenar dois
 * cartões numa lista de dez não deveria escrever dez linhas.
 */
export async function reorderModuleFields(
  fields: { id: string; sortOrder: number }[],
): Promise<void> {
  const client = assertSupabase();

  /* Reescreve a escala do zero (10, 20, 30…) em vez de tentar encaixar um
     valor entre dois vizinhos: os `sort_order` que vêm de `create_user_module`
     e de `addModuleField` já andam de 10 em 10, e recalcular tudo evita o caso
     em que dois campos vizinhos têm valores consecutivos e não sobra espaço
     no meio. */
  const updates = fields
    .map((field, index) => ({ id: field.id, sortOrder: (index + 1) * 10 }))
    .filter((next, index) => next.sortOrder !== fields[index].sortOrder);

  for (const update of updates) {
    const { error } = await client
      .from("module_fields")
      .update({ sort_order: update.sortOrder })
      .eq("id", update.id);
    if (error) throw error;
  }
}

/**
 * Remove a linha de `module_fields` — e **só** ela. O valor daquela chave
 * continua guardado dentro de `module_records.data` nos registros existentes.
 *
 * É deliberado: apagar dado de verdade a partir de "parei de mostrar este
 * campo" seria destrutivo demais para uma ação de dois cliques, e a decisão é
 * reversível (recriar o campo com o mesmo rótulo devolve a mesma chave, e o
 * dado antigo reaparece).
 */
export async function removeModuleField(fieldId: string): Promise<void> {
  const { error } = await assertSupabase().from("module_fields").delete().eq("id", fieldId);
  if (error) throw error;
}
