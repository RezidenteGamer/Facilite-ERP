import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { useModuleCatalog } from "../modules/ModuleCatalogContext";
import { canAccessModule } from "../modules/moduleAccess";
import { moduleIconFor } from "../modules/moduleIcons";
import type { HomeModule } from "./modules";

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

/** Junta a ordem salva com o catálogo: módulos novos entram no fim, removidos somem. */
function reconcileOrder(storedIds: string[] | null, allIds: string[]): string[] {
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
 *
 * A lista de módulos vem do **catálogo do banco**, não de um array em código.
 * `reconcileOrder` já lidava com ids desconhecidos e faltando, então continua
 * valendo palavra por palavra — a única diferença é de onde sai `allIds`.
 *
 * Duas filtragens acontecem antes da ordem: `showOnHome` (Configurações e
 * Permissões são alcançadas por outro caminho e nunca tiveram tile) e o
 * portão de acesso — um módulo sem `can_view` **some** da tela em vez de
 * aparecer e recusar no clique. Some, e não fica desabilitado, porque a tela
 * inicial é um lançador: um tile que não abre nada só ocupa espaço e ensina o
 * usuário a ignorar tiles.
 */
export function useModuleOrder() {
  const { modules: catalog, status } = useModuleCatalog();
  const { hasPermission, profile } = useAuth();

  const visibleModules: HomeModule[] = useMemo(() => {
    const access = {
      hasPermission,
      canManageUsers: Boolean(profile?.canManageUsers),
      canManagePermissions: Boolean(profile?.canManagePermissions),
      canManageBranches: Boolean(profile?.canManageBranches),
      canManageModules: Boolean(profile?.canManageModules),
    };

    return catalog
      .filter((module) => module.showOnHome && canAccessModule(module, access))
      .map((module) => {
        const icon = moduleIconFor(module.iconKey);
        return {
          id: module.id,
          label: module.label,
          icon: icon.icon,
          iconImage: icon.image,
          iconImagePlaceholder: icon.imagePlaceholder,
          iconScale: icon.scale,
          badge: icon.badge,
          path: module.path ?? undefined,
        };
      });
  }, [catalog, hasPermission, profile]);

  const [order, setOrder] = useState<string[]>(() => loadStoredOrder() ?? []);

  /* O catálogo chega depois do primeiro render (é uma consulta), então a
     reconciliação acontece quando ele chega — e de novo se a lista visível
     mudar (troca de papel, permissão revogada). */
  useEffect(() => {
    if (status !== "ready") return;
    setOrder((current) => {
      const allIds = visibleModules.map((m) => m.id);
      const next = reconcileOrder(current.length ? current : loadStoredOrder(), allIds);
      // Devolver o mesmo array quando nada mudou evita um render à toa a cada
      // vez que o catálogo é revalidado.
      const same = next.length === current.length && next.every((id, i) => id === current[i]);
      return same ? current : next;
    });
  }, [status, visibleModules]);

  useEffect(() => {
    if (status !== "ready" || order.length === 0) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(order));
    } catch {
      // Armazenamento indisponível (aba anônima, cota cheia) — ordem não persiste, sem quebrar a tela.
    }
  }, [order, status]);

  const modules: HomeModule[] = order
    .map((id) => visibleModules.find((m) => m.id === id))
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

  const resetOrder = useCallback(
    () => setOrder(visibleModules.map((m) => m.id)),
    [visibleModules],
  );

  return { modules, reorder, resetOrder };
}
