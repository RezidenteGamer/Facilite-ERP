import type { Session, User } from "@supabase/supabase-js";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
  branches: Branch[];
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

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function loadProfile(userId: string) {
      if (!supabase) return;

      const { data: profileRow, error: profileError } = await supabase
        .from("profiles")
        .select(
          "id, name, document, operator_code, active, role_id, roles(name, can_manage_permissions, can_manage_users, can_manage_branches)",
        )
        .eq("id", userId)
        .single();

      if (cancelled) return;

      if (profileError || !profileRow) {
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
      });

      const { data: branchLinks } = await supabase
        .from("user_branches")
        .select("branches(id, code, name, cnpj)")
        .eq("user_id", userId);

      if (cancelled) return;

      const accessibleBranches: Branch[] = (branchLinks ?? [])
        .map((link) => link.branches as unknown as Branch | null)
        .filter((branch): branch is Branch => branch !== null);
      setBranches(accessibleBranches);

      const storedBranchId =
        typeof window !== "undefined" ? window.localStorage.getItem(CURRENT_BRANCH_STORAGE_KEY) : null;
      const validStoredBranch = accessibleBranches.find((branch) => branch.id === storedBranchId);
      setCurrentBranchId(validStoredBranch?.id ?? accessibleBranches[0]?.id ?? null);

      if (!profileRow.role_id) {
        setPermissions({});
        return;
      }

      const { data: rolePerms } = await supabase
        .from("role_permissions")
        .select("module_id, can_view, can_create, can_edit, can_delete")
        .eq("role_id", profileRow.role_id);

      if (cancelled) return;

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
      branches,
      currentBranchId,
      setCurrentBranch,
    }),
    [session, profile, loading, error, hasPermission, branches, currentBranchId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de AuthProvider.");
  return ctx;
}
