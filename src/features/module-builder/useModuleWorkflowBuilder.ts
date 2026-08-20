import { useCallback, useEffect, useMemo, useState } from "react";
import {
  deleteModuleSituation,
  deleteModuleTransition,
  deleteTransitionAction,
  fetchModuleSituations,
  fetchModuleTransitions,
  fetchTransitionActions,
  saveModuleSituation,
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

  return {
    situations,
    situationById,
    transitions,
    actionsByTransition,
    references,
    error,
    reload,
    saveSituation,
    removeSituation,
    saveTransition,
    removeTransition,
    saveAction,
    removeAction,
  };
}
