import { useCallback, useEffect, useState } from "react";
import { HOME_MODULES, type HomeModule } from "./modules";

const STORAGE_KEY = "facilite:home:module-order";

function loadStoredOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(parsed) ? (parsed as string[]) : null;
  } catch {
    return null;
  }
}

/** Junta a ordem salva com HOME_MODULES: módulos novos entram no fim, removidos somem. */
function reconcileOrder(storedIds: string[] | null): string[] {
  const allIds = HOME_MODULES.map((m) => m.id);
  if (!storedIds) return allIds;

  const known = new Set(allIds);
  const kept = storedIds.filter((id) => known.has(id));
  const missing = allIds.filter((id) => !kept.includes(id));
  return [...kept, ...missing];
}

/**
 * Ordem dos módulos da tela inicial — arrastável pelo usuário e persistida
 * no navegador. Reaproveitável por qualquer layout (Original, Foco, Desktop):
 * cada um só decide como desenhar a grade, não como a ordem é guardada.
 */
export function useModuleOrder() {
  const [order, setOrder] = useState<string[]>(() => reconcileOrder(loadStoredOrder()));

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } catch {
      // Armazenamento indisponível (aba anônima, cota cheia) — ordem não persiste, sem quebrar a tela.
    }
  }, [order]);

  const modules: HomeModule[] = order
    .map((id) => HOME_MODULES.find((m) => m.id === id))
    .filter((m): m is HomeModule => Boolean(m));

  const reorder = useCallback((activeId: string, overId: string) => {
    setOrder((current) => {
      const from = current.indexOf(activeId);
      const to = current.indexOf(overId);
      if (from === -1 || to === -1 || from === to) return current;

      const next = current.slice();
      next.splice(from, 1);
      next.splice(to, 0, activeId);
      return next;
    });
  }, []);

  const resetOrder = useCallback(() => setOrder(HOME_MODULES.map((m) => m.id)), []);

  return { modules, reorder, resetOrder };
}
