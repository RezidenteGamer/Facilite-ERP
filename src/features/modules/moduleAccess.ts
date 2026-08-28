import type { PermissionAction } from "../auth/AuthContext";
import type { CatalogModule } from "./catalog";

export type ModuleAccessContext = {
  hasPermission: (moduleId: string, action: PermissionAction) => boolean;
  canManageUsers: boolean;
  canManagePermissions: boolean;
  canManageBranches: boolean;
  /**
   * `profiles.is_facilite_developer` — flag de **pessoa**, ligada só por SQL.
   * É ela, e não mais `roles.can_manage_modules`, que abre o construtor de
   * módulos: ver a decisão de produto de 28/08/2026 em `AGENTS.md`.
   */
  isFaciliteDeveloper: boolean;
};

/**
 * Quem pode ver/entrar num módulo, decidido pelo portão que o catálogo
 * declara. **Uma função só, dois consumidores** — a tela inicial (quais tiles
 * aparecem) e o roteador (quais rotas abrem). Se cada um decidisse por conta
 * própria, um tile visível poderia levar a uma rota bloqueada, ou pior: uma
 * rota aberta poderia ficar sem tile e ninguém notaria o furo.
 *
 * Isto é imposição de UI, não de segurança: quem impõe de verdade é a RLS de
 * cada tabela (`has_permission` nas policies) — esconder o tile só evita o
 * usuário descobrir a porta trancada depois de bater nela.
 */
export function canAccessModule(module: CatalogModule, ctx: ModuleAccessContext): boolean {
  switch (module.accessGate) {
    case "manage_users":
      return ctx.canManageUsers;
    case "manage_permissions":
      return ctx.canManagePermissions;
    case "manage_branches":
      return ctx.canManageBranches;
    /* O nome do portão diz **o que** ele protege (gerenciar módulos), não qual
       flag ele lê — e quem passa mudou: o construtor deixou de ser recurso do
       cliente final e virou ferramenta interna da Facilite. `can_manage_modules`
       continua sendo o portão do **banco** (policies e RPCs de M3/M4), mas
       sozinha não abre mais a tela. */
    case "manage_modules":
      return ctx.isFaciliteDeveloper;
    case "authenticated":
      return true;
    case "permission":
    default:
      return ctx.hasPermission(module.id, "view");
  }
}
