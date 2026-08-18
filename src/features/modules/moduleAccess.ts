import type { PermissionAction } from "../auth/AuthContext";
import type { CatalogModule } from "./catalog";

export type ModuleAccessContext = {
  hasPermission: (moduleId: string, action: PermissionAction) => boolean;
  canManageUsers: boolean;
  canManagePermissions: boolean;
  canManageBranches: boolean;
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
    case "authenticated":
      return true;
    case "permission":
    default:
      return ctx.hasPermission(module.id, "view");
  }
}
