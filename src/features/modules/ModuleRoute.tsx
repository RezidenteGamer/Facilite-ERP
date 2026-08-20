import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useAuth } from "../auth/AuthContext";
import GenericModulePage from "./GenericModulePage";
import type { CatalogModule } from "./catalog";
import { canAccessModule } from "./moduleAccess";
import { MODULE_COMPONENTS } from "./moduleComponents";

/** Mensagem de porta fechada, no mesmo formato que as telas já usam. */
function AccessDenied({ label, gateMessage }: { label: string; gateMessage: string }) {
  const navigate = useNavigate();
  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  return (
    <AppShell navItems={navItems} secondaryText={label} contentTone="blue" fillViewport>
      <p style={{ color: "var(--white)", padding: 24 }}>{gateMessage}</p>
    </AppShell>
  );
}

function gateMessageFor(module: CatalogModule): string {
  switch (module.accessGate) {
    case "manage_users":
      return "Você não tem permissão para gerenciar usuários.";
    case "manage_permissions":
      return "Você não tem permissão para gerenciar permissões.";
    case "manage_branches":
      return "Você não tem permissão para gerenciar filiais.";
    case "manage_modules":
      return "Você não tem permissão para gerenciar módulos.";
    default:
      return "Você não tem permissão para acessar este módulo.";
  }
}

/**
 * Resolve uma entrada do catálogo numa tela.
 *
 * 1. O id está no registro de componentes → é a tela própria do módulo.
 * 2. Não está → cai no motor genérico (`GenericModulePage`), que se monta
 *    inteiro a partir de `module_fields`.
 *
 * O passo 2 é o ponto desta etapa: sem ele, "catálogo no banco" seria só o
 * hardcode mudando de lugar, porque todo módulo novo ainda exigiria um
 * componente escrito à mão antes de existir.
 *
 * O portão de acesso é aplicado aqui, no roteador, e não dentro de cada tela:
 * assim as telas mock (que nunca checaram permissão) passam a ser barradas
 * junto com as reais, e a checagem usa a mesma `canAccessModule` que decide
 * quais tiles aparecem na tela inicial.
 */
export default function ModuleRoute({ module }: { module: CatalogModule }) {
  const { hasPermission, profile } = useAuth();

  const allowed = canAccessModule(module, {
    hasPermission,
    canManageUsers: Boolean(profile?.canManageUsers),
    canManagePermissions: Boolean(profile?.canManagePermissions),
    canManageBranches: Boolean(profile?.canManageBranches),
    canManageModules: Boolean(profile?.canManageModules),
  });

  if (!allowed) return <AccessDenied label={module.label} gateMessage={gateMessageFor(module)} />;

  const OwnComponent = MODULE_COMPONENTS[module.id];
  if (OwnComponent) return <OwnComponent />;

  return <GenericModulePage module={module} />;
}

/** Mesma guarda, para as telas extras de um módulo (`/compras/nova` etc.). */
export function ModuleSubrouteGuard({
  module,
  children,
}: {
  module: CatalogModule | undefined;
  children: React.ReactNode;
}) {
  const { hasPermission, profile } = useAuth();

  // Sem entrada no catálogo não há portão a aplicar — a sub-rota some junto
  // com o módulo dela (ver `App.tsx`), então isto só acontece em transição.
  if (!module) return null;

  const allowed = canAccessModule(module, {
    hasPermission,
    canManageUsers: Boolean(profile?.canManageUsers),
    canManagePermissions: Boolean(profile?.canManagePermissions),
    canManageBranches: Boolean(profile?.canManageBranches),
    canManageModules: Boolean(profile?.canManageModules),
  });

  if (!allowed) return <AccessDenied label={module.label} gateMessage={gateMessageFor(module)} />;

  return <>{children}</>;
}
