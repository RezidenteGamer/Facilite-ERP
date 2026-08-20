import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchModuleSituations,
  fetchModuleTransitions,
  transitionModuleRecord,
  type ModuleSituation,
  type ModuleTransition,
} from "./moduleWorkflow";
import { extractErrorMessage } from "./useGenericModuleData";

/**
 * Lado de **execução** do workflow, usado pela `GenericModulePage`: quais
 * situações existem, qual é a do registro selecionado e quais botões de
 * transição cabem a partir dela.
 *
 * Não carrega as ações de propósito. Quem só usa o módulo vê "Marcar como
 * resolvido" e mais nada — que aquela transição também escreva noutro módulo
 * é assunto de quem configurou, não de quem aciona.
 */
export function useModuleWorkflow(moduleId: string, enabled: boolean) {
  const [situations, setSituations] = useState<ModuleSituation[]>([]);
  const [transitions, setTransitions] = useState<ModuleTransition[]>([]);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!enabled) {
      setSituations([]);
      setTransitions([]);
      return;
    }
    try {
      const [situationRows, transitionRows] = await Promise.all([
        fetchModuleSituations(moduleId),
        fetchModuleTransitions(moduleId),
      ]);
      setSituations(situationRows);
      setTransitions(transitionRows);
      setError(null);
    } catch (err) {
      setError(extractErrorMessage(err, "Erro ao carregar as situações do módulo."));
    }
  }, [moduleId, enabled]);

  useEffect(() => {
    reload();
  }, [reload]);

  const byId = useMemo(() => {
    const map: Record<string, ModuleSituation> = {};
    for (const situation of situations) map[situation.id] = situation;
    return map;
  }, [situations]);

  const initialCode = useMemo(
    () => situations.find((situation) => situation.isInitial)?.code ?? null,
    [situations],
  );

  /**
   * `status` nulo num módulo que já tem workflow = registro criado antes das
   * situações existirem. A `GenericModulePage` mostra (e a RPC assume) que
   * ele está na situação inicial — mesma regra dos dois lados, senão o botão
   * apareceria na tela e o banco recusaria.
   */
  const resolveCode = useCallback(
    (status: string | null | undefined) => status ?? initialCode,
    [initialCode],
  );

  const labelForStatus = useCallback(
    (status: string | null | undefined) => {
      const code = resolveCode(status);
      if (!code) return null;
      return situations.find((situation) => situation.code === code)?.label ?? code;
    },
    [situations, resolveCode],
  );

  const transitionsFrom = useCallback(
    (status: string | null | undefined) => {
      const code = resolveCode(status);
      if (!code) return [];
      return transitions.filter((transition) => byId[transition.fromSituationId]?.code === code);
    },
    [transitions, byId, resolveCode],
  );

  const run = useCallback(
    (recordId: string, toSituationId: string) => transitionModuleRecord(recordId, toSituationId),
    [],
  );

  return {
    situations,
    transitions,
    hasWorkflow: situations.length > 0,
    error,
    reload,
    labelForStatus,
    transitionsFrom,
    run,
  };
}
