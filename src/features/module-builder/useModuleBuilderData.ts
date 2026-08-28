import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useModuleCatalog } from "../modules/ModuleCatalogContext";
import { extractErrorMessage } from "../modules/useGenericModuleData";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import type { FieldsPlan } from "./fieldsJsonPlan";
import {
  addModuleField,
  createUserModule,
  deleteUserModule,
  fetchBuilderModules,
  fetchModuleFields,
  removeModuleField,
  reorderModuleFields,
  updateModuleField,
  type BuilderModule,
  type NewModuleField,
  type NewModuleInput,
} from "./moduleBuilder";

/**
 * Estado do construtor de módulos: a lista do catálogo cru e os campos do
 * módulo selecionado.
 *
 * Depois de criar ou excluir um módulo o catálogo do app inteiro muda (rota,
 * tile da tela inicial, dock), e a permissão do criador acabou de nascer no
 * banco. Por isso as duas ações recarregam **também** o catálogo compartilhado
 * e as permissões da sessão — senão o módulo recém-criado só apareceria depois
 * de um F5, e o tile ficaria escondido por uma permissão que já existe no
 * banco mas não no cache do cliente.
 */
export function useModuleBuilderData() {
  const { reload: reloadCatalog } = useModuleCatalog();
  const { refreshPermissions } = useAuth();

  const [modules, setModules] = useState<BuilderModule[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [fields, setFields] = useState<ModuleFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reloadModules = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await fetchBuilderModules();
      setModules(rows);
      setError(null);
      return rows;
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar os módulos."));
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadFields = useCallback(async (moduleId: string | null) => {
    if (!moduleId) {
      setFields([]);
      return;
    }
    try {
      setFields(await fetchModuleFields(moduleId));
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar os campos do módulo."));
    }
  }, []);

  useEffect(() => {
    reloadModules();
  }, [reloadModules]);

  useEffect(() => {
    reloadFields(selectedId);
  }, [selectedId, reloadFields]);

  const selected = modules.find((module) => module.id === selectedId) ?? null;

  const createModule = useCallback(
    async (input: NewModuleInput) => {
      const id = await createUserModule(input);
      await Promise.all([reloadModules(), reloadCatalog(), refreshPermissions()]);
      setSelectedId(id);
      return id;
    },
    [reloadModules, reloadCatalog, refreshPermissions],
  );

  const deleteModule = useCallback(
    async (moduleId: string) => {
      await deleteUserModule(moduleId);
      setSelectedId(null);
      await Promise.all([reloadModules(), reloadCatalog(), refreshPermissions()]);
    },
    [reloadModules, reloadCatalog, refreshPermissions],
  );

  const addField = useCallback(
    async (moduleId: string, field: NewModuleField) => {
      await addModuleField(moduleId, field);
      await reloadFields(moduleId);
    },
    [reloadFields],
  );

  const editField = useCallback(
    async (fieldId: string, patch: NewModuleField) => {
      await updateModuleField(fieldId, patch);
      await reloadFields(selectedId);
    },
    [reloadFields, selectedId],
  );

  /**
   * Ordem nova vinda do arraste no canvas. O estado local muda antes da ida
   * ao banco — os cartões precisam ficar onde foram soltos, não voltar e
   * pular. O erro (se houver) recarrega a ordem de verdade.
   */
  const reorderFields = useCallback(
    async (orderedIds: string[]) => {
      const byId = new Map(fields.map((field) => [field.id, field]));
      const ordered = orderedIds
        .map((id) => byId.get(id))
        .filter((field): field is ModuleFieldDefinition => Boolean(field));
      if (ordered.length !== fields.length) return;

      // Os `sort_order` de origem, para a gravação só tocar no que mudou.
      const payload = ordered.map((field) => ({ id: field.id, sortOrder: field.sortOrder }));
      setFields(ordered.map((field, index) => ({ ...field, sortOrder: (index + 1) * 10 })));

      try {
        await reorderModuleFields(payload);
      } catch (err) {
        setError(extractErrorMessage(err, "Não foi possível gravar a ordem dos campos."));
        await reloadFields(selectedId);
      }
    },
    [fields, reloadFields, selectedId],
  );

  const dropField = useCallback(
    async (fieldId: string) => {
      await removeModuleField(fieldId);
      await reloadFields(selectedId);
    },
    [reloadFields, selectedId],
  );

  /**
   * Aplica de uma vez a lista de campos vinda da visão JSON (Fase 2). O plano
   * já chega validado por `planFieldsJson` — aqui só se gravam as chamadas que
   * ele decidiu, exatamente as mesmas que o canvas usa uma a uma.
   *
   * Três detalhes que explicam a forma deste código:
   *
   * - **Chama as funções do repositório, não os wrappers acima** (`addField`,
   *   `editField`…): cada wrapper recarrega os campos depois de escrever, o que
   *   daria uma ida ao banco por item da lista; e `reorderFields` fecha sobre o
   *   `fields` do render, que fica velho no meio de uma sequência de escritas.
   *   Aqui a lista é relida uma vez, no fim, quando já existem ids reais.
   * - **Remoções antes das criações**: assim a chave de um campo removido nesta
   *   mesma aplicação fica livre para um campo novo (remover não apaga o dado
   *   guardado no jsonb — recriar com o mesmo rótulo o traz de volta).
   * - **Para na primeira falha**, e o erro diz o que já tinha passado: seguir
   *   depois de um `insert` recusado por RLS deixaria o módulo num estado
   *   parcial que ninguém consegue reconstruir de cabeça.
   */
  const applyFieldsPlan = useCallback(
    async (moduleId: string, plan: FieldsPlan): Promise<string[]> => {
      const applied: string[] = [];
      const createdIds: string[] = [];

      try {
        for (const edit of plan.edits) {
          await updateModuleField(edit.id, edit.patch);
          applied.push(`“${edit.label}” alterado (${edit.changed.join(", ")})`);
        }
        for (const drop of plan.drops) {
          await removeModuleField(drop.id);
          applied.push(`“${drop.label}” removido`);
        }
        for (const add of plan.adds) {
          createdIds.push(await addModuleField(moduleId, add.field));
          applied.push(`“${add.label}” criado`);
        }

        /* A ordem só faz sentido com ids reais, então vem por último — e a
           lista de referência é relida do banco, porque `fields` ainda é o
           estado anterior a estas escritas. */
        const fresh = await fetchModuleFields(moduleId);
        const sortOrderById = new Map(fresh.map((field) => [field.id, field.sortOrder]));
        const finalIds = plan.order.map((entry) =>
          entry.kind === "existing" ? entry.id : createdIds[entry.addIndex],
        );
        const sameLength = finalIds.length === fresh.length;
        const alreadyInOrder = sameLength && fresh.every((field, i) => field.id === finalIds[i]);
        if (sameLength && !alreadyInOrder && finalIds.every((id) => sortOrderById.has(id))) {
          await reorderModuleFields(
            finalIds.map((id) => ({ id, sortOrder: sortOrderById.get(id) ?? 0 })),
          );
          applied.push("ordem atualizada");
        }

        return applied;
      } catch (err) {
        const detail = extractErrorMessage(err, "a gravação foi recusada.");
        throw new Error(
          applied.length
            ? `Parou na primeira falha: ${detail} Já tinha sido aplicado antes disso: ${applied.join("; ")}. O resto da lista não foi gravado.`
            : `Parou na primeira falha: ${detail} Nada foi gravado.`,
        );
      } finally {
        await reloadFields(moduleId);
      }
    },
    [reloadFields],
  );

  return {
    modules,
    selected,
    selectedId,
    setSelectedId,
    fields,
    loading,
    error,
    setError,
    createModule,
    deleteModule,
    addField,
    editField,
    reorderFields,
    dropField,
    applyFieldsPlan,
  };
}
