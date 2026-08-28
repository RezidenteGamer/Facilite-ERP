import { useCallback, useRef, useState } from "react";
import type { ModuleFieldDefinition } from "../registry-engine/types";

/**
 * Últimas N ações desfazíveis. Vinte é o suficiente para cobrir uma sessão de
 * ajustes seguidos sem a pilha virar um vazamento de memória silencioso numa
 * tela que fica aberta o dia inteiro.
 */
const HISTORY_LIMIT = 20;

/** O array de campos inteiro, como estava **antes** de uma ação. */
export type FieldsSnapshot = ModuleFieldDefinition[];

/**
 * Desfazer/refazer do construtor de campos — uma pilha de snapshots da lista
 * `fields`, **em memória e só isso**: recarregar a página zera o histórico, do
 * mesmo jeito que num editor. Persistir isso entre sessões exigiria decidir o
 * que fazer quando o banco mudou por outra via no meio do caminho, e a
 * resposta certa para uma ferramenta interna é "não persiste".
 *
 * O que este arquivo **não** tem é um mecanismo de aplicação próprio. Um
 * snapshot é uma lista de campos desejada, e transformar uma lista desejada
 * nas escritas que faltam já é o trabalho de `fieldsJsonPlan.ts` (Fase 2) —
 * quem chama passa esse `apply` pronto. Aqui só moram as duas pilhas e a
 * disciplina de quem empurra o quê:
 *
 * - `record(fields)` antes de **cada** ação que muda algo — a pilha guarda o
 *   estado anterior, e o futuro é descartado (é o galho que a ação nova podou).
 * - `undo` tira do passado e empurra o estado atual para o futuro; `redo` faz
 *   o inverso. Nenhum dos dois chama `record`, senão desfazer viraria mais uma
 *   ação a desfazer.
 * - `busy` serializa as duas: aplicar um snapshot é assíncrono (várias idas ao
 *   banco), e um segundo Ctrl+Z no meio dessa ida leria um `fields` velho e
 *   empurraria o snapshot errado para o futuro.
 */
export function useFieldsHistory(apply: (snapshot: FieldsSnapshot) => Promise<void>) {
  const [past, setPast] = useState<FieldsSnapshot[]>([]);
  const [future, setFuture] = useState<FieldsSnapshot[]>([]);
  const busy = useRef(false);

  const record = useCallback((before: FieldsSnapshot) => {
    setPast((stack) => [...stack, before].slice(-HISTORY_LIMIT));
    setFuture([]);
  }, []);

  /** Trocar de módulo (ou recarregar a lista por outra via) invalida a pilha:
      os ids de um módulo não dizem nada sobre outro. */
  const reset = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  const undo = useCallback(
    async (current: FieldsSnapshot) => {
      if (busy.current || past.length === 0) return;
      busy.current = true;
      const target = past[past.length - 1];
      setPast(past.slice(0, -1));
      setFuture((stack) => [...stack, current].slice(-HISTORY_LIMIT));
      try {
        await apply(target);
      } finally {
        busy.current = false;
      }
    },
    [apply, past],
  );

  const redo = useCallback(
    async (current: FieldsSnapshot) => {
      if (busy.current || future.length === 0) return;
      busy.current = true;
      const target = future[future.length - 1];
      setFuture(future.slice(0, -1));
      setPast((stack) => [...stack, current].slice(-HISTORY_LIMIT));
      try {
        await apply(target);
      } finally {
        busy.current = false;
      }
    },
    [apply, future],
  );

  return {
    record,
    reset,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
