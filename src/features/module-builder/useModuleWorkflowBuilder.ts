import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteModuleSituation,
  deleteModuleTransition,
  deleteTransitionAction,
  fetchModuleSituations,
  fetchModuleTransitions,
  fetchTransitionActions,
  saveModuleSituation,
  saveModuleSituationPosition,
  saveModuleTransition,
  saveTransitionAction,
  type ModuleSituation,
  type ModuleTransition,
  type ModuleTransitionAction,
  type SituationInput,
  type TransitionActionInput,
  type TransitionInput,
} from "../modules/moduleWorkflow";
import { extractErrorMessage } from "../modules/useGenericModuleData";
import type { ModuleFieldDefinition } from "../registry-engine/types";
import { fetchModuleFields } from "./moduleBuilder";
import type { WorkflowPlan } from "./workflowJsonPlan";

/**
 * Um salto de referência que sai deste módulo: por qual campo se atravessa,
 * para qual módulo se chega, e quais campos existem do outro lado.
 *
 * É o que a Camada 2 precisa saber para montar as duas perguntas que ela faz
 * ("seguindo qual campo?" e "qual campo do outro módulo?"), e **só um
 * salto** — referência em cadeia está fora de escopo de propósito.
 */
export type ReferenceTarget = {
  fieldKey: string;
  fieldLabel: string;
  moduleId: string;
  moduleLabel: string;
  fields: ModuleFieldDefinition[];
};

type LoadedReference = Omit<ReferenceTarget, "moduleLabel">;

/**
 * Lado de **configuração** do workflow, usado só pela tela `/modulos`.
 * Diferente de `useModuleWorkflow` (que serve a execução), este carrega
 * também as ações e os campos dos módulos referenciados.
 */
export function useModuleWorkflowBuilder(
  moduleId: string | null,
  fields: ModuleFieldDefinition[],
  moduleLabels: Record<string, string>,
) {
  const [situations, setSituations] = useState<ModuleSituation[]>([]);
  const [transitions, setTransitions] = useState<ModuleTransition[]>([]);
  const [actions, setActions] = useState<ModuleTransitionAction[]>([]);
  const [loadedReferences, setLoadedReferences] = useState<LoadedReference[]>([]);
  const [error, setError] = useState<string | null>(null);

  /* Assinatura estável dos campos de referência: `fields` é recriado a cada
     render de quem chama, e depender dele por identidade recarregaria sem
     parar. JSON em vez de string com separador — rótulo de campo é texto
     livre e pode conter qualquer caractere que se escolhesse como separador. */
  const referenceSignature = useMemo(
    () =>
      JSON.stringify(
        fields
          .filter((field) => field.referenceModuleId)
          .map((field) => [field.fieldKey, field.label, field.referenceModuleId]),
      ),
    [fields],
  );

  const reload = useCallback(async () => {
    if (!moduleId) {
      setSituations([]);
      setTransitions([]);
      setActions([]);
      return;
    }
    try {
      const [situationRows, transitionRows] = await Promise.all([
        fetchModuleSituations(moduleId),
        fetchModuleTransitions(moduleId),
      ]);
      setSituations(situationRows);
      setTransitions(transitionRows);
      setActions(await fetchTransitionActions(transitionRows.map((row) => row.id)));
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar o workflow do módulo."));
    }
  }, [moduleId]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    let cancelled = false;

    async function loadReferences() {
      const entries = JSON.parse(referenceSignature) as [string, string, string][];
      if (entries.length === 0) {
        setLoadedReferences([]);
        return;
      }

      try {
        const loaded = await Promise.all(
          entries.map(async ([fieldKey, fieldLabel, targetModuleId]) => ({
            fieldKey,
            fieldLabel,
            moduleId: targetModuleId,
            fields: await fetchModuleFields(targetModuleId),
          })),
        );
        if (!cancelled) setLoadedReferences(loaded);
      } catch (err) {
        if (!cancelled) {
          setError(extractErrorMessage(err, "Erro ao carregar os módulos referenciados."));
        }
      }
    }

    loadReferences();
    return () => {
      cancelled = true;
    };
  }, [referenceSignature]);

  /* O rótulo do módulo referenciado é resolvido aqui, e não dentro do efeito:
     `moduleLabels` vem de um objeto recriado pela página a cada render, e
     depender dele para buscar dados daria um laço de recarga infinito. */
  const references = useMemo<ReferenceTarget[]>(
    () =>
      loadedReferences.map((reference) => ({
        ...reference,
        moduleLabel: moduleLabels[reference.moduleId] ?? reference.moduleId,
      })),
    [loadedReferences, moduleLabels],
  );

  const actionsByTransition = useMemo(() => {
    const map: Record<string, ModuleTransitionAction[]> = {};
    for (const action of actions) {
      (map[action.transitionId] ??= []).push(action);
    }
    return map;
  }, [actions]);

  const situationById = useMemo(() => {
    const map: Record<string, ModuleSituation> = {};
    for (const situation of situations) map[situation.id] = situation;
    return map;
  }, [situations]);

  const saveSituation = useCallback(
    async (input: SituationInput) => {
      if (!moduleId) return;
      await saveModuleSituation(moduleId, input);
      await reload();
    },
    [moduleId, reload],
  );

  /**
   * Arrastar um nó do diagrama. O estado local muda **antes** da ida ao
   * banco: uma caixa que volta para o lugar antigo e só depois pula para o
   * novo tornaria o arraste inutilizável. Se a gravação falhar, o erro
   * aparece e o `reload` traz a posição real de volta.
   */
  const moveSituation = useCallback(
    async (id: string, x: number, y: number) => {
      setSituations((previous) =>
        previous.map((situation) =>
          situation.id === id ? { ...situation, canvasX: x, canvasY: y } : situation,
        ),
      );
      try {
        await saveModuleSituationPosition(id, x, y);
      } catch (err) {
        setError(extractErrorMessage(err, "Não foi possível gravar a posição da situação."));
        await reload();
      }
    },
    [reload],
  );

  const removeSituation = useCallback(
    async (id: string) => {
      await deleteModuleSituation(id);
      await reload();
    },
    [reload],
  );

  const saveTransition = useCallback(
    async (input: TransitionInput) => {
      if (!moduleId) return;
      await saveModuleTransition(moduleId, input);
      await reload();
    },
    [moduleId, reload],
  );

  const removeTransition = useCallback(
    async (id: string) => {
      await deleteModuleTransition(id);
      await reload();
    },
    [reload],
  );

  const saveAction = useCallback(
    async (transitionId: string, input: TransitionActionInput) => {
      await saveTransitionAction(transitionId, input);
      await reload();
    },
    [reload],
  );

  const removeAction = useCallback(
    async (id: string) => {
      await deleteTransitionAction(id);
      await reload();
    },
    [reload],
  );

  /**
   * Executa o plano da visão JSON. **Chama as funções do repositório, não os
   * wrappers acima**, pelo mesmo motivo de `applyFieldsPlan`: cada wrapper
   * recarrega o workflow inteiro depois de escrever, o que daria uma ida ao
   * banco por item. Aqui a lista é relida **uma vez**, no fim — com sucesso ou
   * com falha, para o textarea voltar a mostrar a verdade (inclusive os ids
   * reais do que acabou de ser criado).
   *
   * A ordem das nove etapas não é arbitrária:
   *
   * 1. **Remover vem antes de criar**, nos três níveis, e de dentro para fora:
   *    ação → transição → situação. O banco recusa apagar uma situação que
   *    ainda tem transição, e recusa criar uma transição para um par
   *    `(de, para)` que já existe — remover primeiro libera o par e o código
   *    da situação para um item novo desta mesma aplicação.
   * 2. **A situação inicial é trocada no fim, numa chamada própria.** A RPC
   *    recusa desmarcar a inicial vigente, então o valor atual viaja nas
   *    edições e a troca acontece depois que todas as situações existem —
   *    funcionando igual quando a nova inicial já existia, acabou de ser
   *    criada, ou substitui uma que acabou de ser removida.
   * 3. **As transições precisam dos ids reais das situações novas**, e as
   *    ações dos ids das transições novas. Por isso as duas criações devolvem
   *    o id (as RPCs já devolviam) e ele é guardado nos mapas abaixo — o
   *    cliente não teria como adivinhá-los.
   *
   * Se uma escrita falhar, a aplicação **para ali** e a mensagem diz o que já
   * tinha passado: seguir em frente deixaria um workflow parcial que ninguém
   * consegue reconstruir de cabeça.
   */
  const applyWorkflowPlan = useCallback(
    async (plan: WorkflowPlan): Promise<string[]> => {
      if (!moduleId) return [];
      const applied: string[] = [];
      /* Código da situação → id real, para as transições resolverem "from"/"to". */
      const situationIdByCode = new Map(
        situations.map((situation) => [situation.code, situation.id]),
      );
      const createdTransitionIds: string[] = [];

      function situationId(code: string): string {
        const id = situationIdByCode.get(code);
        if (!id) throw new Error(`A situação de código “${code}” não foi encontrada.`);
        return id;
      }

      try {
        for (const drop of plan.actionDrops) {
          await deleteTransitionAction(drop.id);
          applied.push(`${drop.label} removida`);
        }
        for (const drop of plan.transitionDrops) {
          await deleteModuleTransition(drop.id);
          applied.push(`transição “${drop.label}” removida`);
        }
        for (const drop of plan.situationDrops) {
          await deleteModuleSituation(drop.id);
          /* O código volta a ficar livre: uma situação nova desta mesma
             aplicação pode reusá-lo, e aí quem resolve "from"/"to" precisa
             encontrar o id novo, não o da linha que acabou de sumir. */
          situationIdByCode.delete(drop.code);
          applied.push(`situação “${drop.label}” removida`);
        }

        for (const edit of plan.situationEdits) {
          await saveModuleSituation(moduleId, edit.input);
          applied.push(`situação “${edit.label}” alterada (${edit.changed.join(", ")})`);
        }
        for (const add of plan.situationAdds) {
          situationIdByCode.set(add.code, await saveModuleSituation(moduleId, add.input));
          applied.push(`situação “${add.label}” criada`);
        }
        if (plan.promoteInitial) {
          await saveModuleSituation(moduleId, {
            id: situationId(plan.promoteInitial.code),
            label: plan.promoteInitial.label,
            sortOrder: plan.promoteInitial.sortOrder,
            isInitial: true,
          });
          applied.push(`“${plan.promoteInitial.label}” virou a situação inicial`);
        }

        for (const edit of plan.transitionEdits) {
          await saveModuleTransition(moduleId, edit.input);
          applied.push(`transição “${edit.label}” alterada (${edit.changed.join(", ")})`);
        }
        for (const add of plan.transitionAdds) {
          createdTransitionIds.push(
            await saveModuleTransition(moduleId, {
              id: null,
              fromSituationId: situationId(add.fromCode),
              toSituationId: situationId(add.toCode),
              label: add.label,
              sortOrder: add.sortOrder,
            }),
          );
          applied.push(`transição “${add.label}” criada`);
        }

        for (const edit of plan.actionEdits) {
          await saveTransitionAction(edit.transitionId, edit.input);
          applied.push(`${edit.label} alterada (${edit.changed.join(", ")})`);
        }
        for (const add of plan.actionAdds) {
          const transitionId =
            add.transition.kind === "existing"
              ? add.transition.id
              : createdTransitionIds[add.transition.addIndex];
          await saveTransitionAction(transitionId, add.input);
          applied.push(`${add.label} criada`);
        }

        return applied;
      } catch (err) {
        const detail = extractErrorMessage(err, "a gravação foi recusada.");
        throw new Error(
          applied.length
            ? `Parou na primeira falha: ${detail} Já tinha sido aplicado antes disso: ${applied.join("; ")}. O resto do documento não foi gravado.`
            : `Parou na primeira falha: ${detail} Nada foi gravado.`,
        );
      } finally {
        await reload();
      }
    },
    [moduleId, situations, reload],
  );

  return {
    situations,
    situationById,
    transitions,
    actionsByTransition,
    references,
    error,
    reload,
    saveSituation,
    moveSituation,
    removeSituation,
    saveTransition,
    removeTransition,
    saveAction,
    removeAction,
    applyWorkflowPlan,
  };
}
