import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "../../lib/supabaseClient";

export type PermissionAction = "view" | "create" | "edit" | "delete";

type ModulePermission = {
  canView: boolean;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type Profile = {
  id: string;
  name: string;
  document: string;
  operatorCode: string;
  active: boolean;
  roleId: string | null;
  roleName: string | null;
  canManagePermissions: boolean;
  canManageUsers: boolean;
  canManageBranches: boolean;
  /**
   * **Obsoleta como portão de UI** (decisão de produto de 28/08/2026, ver
   * AGENTS.md): não abre mais `/modulos`, nem faz o tile aparecer — quem abre
   * o construtor é `isFaciliteDeveloper`. Continua sendo lida do papel porque
   * ainda é o portão do **banco**: as policies de `modules`/`module_fields` e
   * as RPCs de M3/M4 exigem `can_manage_modules()`. Sem consumidor no front
   * hoje; fica aqui para que a assimetria "front exige mais que o banco" seja
   * visível em vez de esquecida.
   */
  canManageModules: boolean;
  /**
   * Desenvolvedor do Facilite — **não** é papel do cliente. Vem de
   * `profiles`, não de `roles`, porque é característica da pessoa e não do
   * cargo que ela ocupa numa empresa cliente; o Administrador do cliente não
   * tem como conceder isso a ninguém, nem a si mesmo. Liga-se por SQL direto
   * no banco, sem UI nenhuma — ver M4 no AGENTS.md.
   *
   * Desde 28/08/2026 é o **portão de entrada do construtor de módulos**
   * inteiro (`/modulos`, seu tile e sua rota), e não só dos controles de
   * Camada 2 dentro dele (apontar um campo para outro módulo, configurar ação
   * que lê/escreve num módulo relacionado). Não dá acesso a nada mais.
   */
  isFaciliteDeveloper: boolean;
};

export type Branch = {
  id: string;
  code: string;
  name: string;
  cnpj: string | null;
};

const CURRENT_BRANCH_STORAGE_KEY = "facilite:currentBranchId";

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
  hasPermission: (moduleId: string, action: PermissionAction) => boolean;
  /**
   * Relê `role_permissions` do papel atual. Existe por causa do construtor
   * de módulos (M3): ao criar um módulo o banco concede as quatro
   * permissões ao papel de quem criou, e sem isto o cache da sessão
   * continuaria sem elas — o tile do módulo recém-criado ficaria escondido
   * por uma permissão que já existe no banco.
   */
  refreshPermissions: () => Promise<void>;
  branches: Branch[];
  /**
   * Relê as filiais do usuário. Mesmo motivo de `refreshPermissions`: a lista
   * é carregada uma vez, na sessão, e a tela de Filiais (D1) muda código, nome
   * e CNPJ **dela** — sem isto o seletor de filial e a faixa do cabeçalho
   * continuariam mostrando o nome antigo até o próximo F5.
   *
   * Não mexe na filial ativa enquanto ela continuar acessível: trocar a filial
   * ativa por causa de uma edição de cadastro seria um efeito colateral que
   * ninguém pediu, e o operador poderia lançar na filial errada sem perceber.
   */
  refreshBranches: () => Promise<void>;
  currentBranchId: string | null;
  setCurrentBranch: (branchId: string) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/** Sessão Supabase + perfil/papel + permissões por módulo do usuário logado. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [permissions, setPermissions] = useState<Record<string, ModulePermission>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentBranchId, setCurrentBranchId] = useState<string | null>(null);
  /**
   * Id do usuário cujo perfil, filiais e permissões já foram carregados por
   * inteiro nesta aba — `null` enquanto nada carregou.
   *
   * Existe por causa de um modo de falha encontrado testando o PDV offline
   * (E6, 10/09/2026). `loadProfile` roda de novo a cada `onAuthStateChange`,
   * e o supabase-js emite esse evento sozinho quando a aba volta a ficar
   * visível. Com a rede caída, as três leituras aqui dentro falham — e o
   * código apagava perfil, filiais e permissões, deixando o operador olhando
   * "Você não tem permissão para acessar este módulo" no meio de uma venda,
   * só por ter dado Alt+Tab. Ver a mesma correção em `ModuleCatalogContext`.
   *
   * É `ref` e não estado porque quem pergunta são os trechos depois de
   * `await`, que precisam da resposta de agora.
   */
  const perfilCarregado = useRef<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadProfile(userId: string) {
      if (!supabase) return;

      /*
       * Releitura de um perfil que já está valendo. Se qualquer das leituras
       * abaixo falhar (rede caída é o caso), o certo é **manter o que já
       * está na tela** em vez de trocá-lo por um estado vazio que nega acesso
       * a tudo. Uma recusa de verdade do banco (perfil desativado, papel
       * removido) só aparece na próxima leitura que der certo — é o preço, e
       * é muito menor que o de derrubar o caixa.
       */
      const jaCarregado = perfilCarregado.current === userId;

      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select(
          "id, name, document, operator_code, active, role_id, is_facilite_developer, roles(name, can_manage_permissions, can_manage_users, can_manage_branches, can_manage_modules)",
        )
        .eq("id", userId)
        .single();

      if (cancelled) return;

      if (profileError || !profileRow) {
        if (jaCarregado) return;
        setError(profileError?.message ?? "Perfil não encontrado.");
        setProfile(null);
        setPermissions({});
        return;
      }

      const role = profileRow.roles as unknown as {
        name: string;
        can_manage_permissions: boolean;
        can_manage_users: boolean;
        can_manage_branches: boolean;
        can_manage_modules: boolean;
      } | null;

      setProfile({
        id: profileRow.id,
        name: profileRow.name,
        document: profileRow.document,
        operatorCode: profileRow.operator_code,
        active: profileRow.active,
        roleId: profileRow.role_id,
        roleName: role?.name ?? null,
        canManagePermissions: role?.can_manage_permissions ?? false,
        canManageUsers: role?.can_manage_users ?? false,
        canManageBranches: role?.can_manage_branches ?? false,
        canManageModules: role?.can_manage_modules ?? false,
        isFaciliteDeveloper: profileRow.is_facilite_developer ?? false,
      });

      const { data: branchLinks, error: branchesError } = await supabase
        .from("user_branches")
        .select("branches(id, code, name, cnpj)")
        .eq("user_id", userId);

      if (cancelled) return;
      // `branchLinks ?? []` trataria erro de leitura como "este usuário não
      // tem filial nenhuma" — e sem filial o PDV não vende.
      if (branchesError && jaCarregado) return;

      const accessibleBranches: Branch[] = (branchLinks ?? [])
        .map((link) => link.branches as unknown as Branch | null)
        .filter((branch): branch is Branch => branch !== null);
      setBranches(accessibleBranches);

      const storedBranchId =
        typeof window !== "undefined" ? window.localStorage.getItem(CURRENT_BRANCH_STORAGE_KEY) : null;
      const validStoredBranch = accessibleBranches.find((branch) => branch.id === storedBranchId);
      setCurrentBranchId(validStoredBranch?.id ?? accessibleBranches[0]?.id ?? null);

      if (!profileRow.role_id) {
        // Usuário sem papel: nada mais a ler, e o carregamento está completo
        // — marcar aqui também é o que dá a ele a mesma proteção contra
        // releitura falhada que todos os outros têm.
        setPermissions({});
        perfilCarregado.current = userId;
        return;
      }

      const { data: rolePerms, error: permsError } = await supabase
        .from("role_permissions")
        .select("module_id, can_view, can_create, can_edit, can_delete")
        .eq("role_id", profileRow.role_id);

      if (cancelled) return;
      // Mesma armadilha do bloco de filiais: leitura que falhou não é "este
      // papel não pode nada".
      if (permsError && jaCarregado) return;

      const map: Record<string, ModulePermission> = {};
      for (const perm of rolePerms ?? []) {
        map[perm.module_id] = {
          canView: perm.can_view,
          canCreate: perm.can_create,
          canEdit: perm.can_edit,
          canDelete: perm.can_delete,
        };
      }
      setPermissions(map);
      perfilCarregado.current = userId;
    }

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      if (data.session?.user) {
        await loadProfile(data.session.user.id);
      }
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (cancelled) return;
      setSession(newSession);
      if (newSession?.user) {
        await loadProfile(newSession.user.id);
      } else {
        setProfile(null);
        setPermissions({});
        setBranches([]);
        setCurrentBranchId(null);
      }
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signIn(email: string, password: string) {
    if (!supabase) {
      return { error: "Supabase não está configurado." };
    }
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    return { error: signInError?.message ?? null };
  }

  async function signOut() {
    await supabase?.auth.signOut();
  }

  function setCurrentBranch(branchId: string) {
    setCurrentBranchId(branchId);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CURRENT_BRANCH_STORAGE_KEY, branchId);
    }
  }

  const refreshPermissions = useCallback(async () => {
    if (!supabase || !profile?.roleId) return;
    const { data } = await supabase
      .from("role_permissions")
      .select("module_id, can_view, can_create, can_edit, can_delete")
      .eq("role_id", profile.roleId);

    const map: Record<string, ModulePermission> = {};
    for (const perm of data ?? []) {
      map[perm.module_id] = {
        canView: perm.can_view,
        canCreate: perm.can_create,
        canEdit: perm.can_edit,
        canDelete: perm.can_delete,
      };
    }
    setPermissions(map);
  }, [profile?.roleId]);

  const refreshBranches = useCallback(async () => {
    if (!supabase) return;
    const userId = session?.user?.id;
    if (!userId) return;

    const { data } = await supabase
      .from("user_branches")
      .select("branches(id, code, name, cnpj)")
      .eq("user_id", userId);

    const accessibleBranches: Branch[] = (data ?? [])
      .map((link) => link.branches as unknown as Branch | null)
      .filter((branch): branch is Branch => branch !== null);

    setBranches(accessibleBranches);
    setCurrentBranchId((current) =>
      current && accessibleBranches.some((branch) => branch.id === current)
        ? current
        : (accessibleBranches[0]?.id ?? null),
    );
  }, [session?.user?.id]);

  const hasPermission = useCallback(
    (moduleId: string, action: PermissionAction): boolean => {
      const perm = permissions[moduleId];
      if (!perm) return false;
      if (action === "view") return perm.canView;
      if (action === "create") return perm.canCreate;
      if (action === "edit") return perm.canEdit;
      return perm.canDelete;
    },
    [permissions],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      error,
      signIn,
      signOut,
      hasPermission,
      refreshPermissions,
      branches,
      refreshBranches,
      currentBranchId,
      setCurrentBranch,
    }),
    [
      session,
      profile,
      loading,
      error,
      hasPermission,
      refreshPermissions,
      branches,
      refreshBranches,
      currentBranchId,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return ctx;
}
