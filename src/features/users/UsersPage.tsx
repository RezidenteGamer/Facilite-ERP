import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import { useOpenWindows } from "../../components/openWindows";
import {
  RegistryActions,
  RegistryDetails,
  RegistryLayout,
  RegistryTable,
  type RegistryColumn,
} from "../../components/registry";
import { useAuth } from "../auth/AuthContext";
import { UsersIcon } from "../home/icons";
import ResetPasswordModal from "./ResetPasswordModal";
import UserFormModal, { type UserFormValues } from "./UserFormModal";
import { useUsersData } from "./useUsersData";
import type { SystemUser } from "./users";

const COLUNAS: RegistryColumn<SystemUser>[] = [
  { key: "code", label: "Código", width: "80px", align: "center", render: (u) => u.code },
  { key: "name", label: "Nome", width: "minmax(0, 1fr)", render: (u) => u.name },
  { key: "document", label: "CPF/CNPJ", width: "150px", render: (u) => u.document },
  { key: "operatorCode", label: "Operador", width: "100px", align: "center", render: (u) => u.operatorCode },
];

type ModalState = "none" | "new" | "edit" | "reset-password";

/** Módulo "Usuarios e Operadores". */
export default function UsersPage() {
  const navigate = useNavigate();
  const { openWindow } = useOpenWindows();
  const { profile } = useAuth();

  const { users, roles, error, createUser, updateUser, resetPassword } = useUsersData();

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>("none");
  const [actionError, setActionError] = useState<string | null>(null);

  const canManageUsers = Boolean(profile?.canManageUsers);

  useEffect(() => {
    openWindow({
      id: "usuarios-operadores",
      label: "Usuarios e Operadores",
      path: "/usuarios-operadores",
      icon: UsersIcon,
    });
  }, [openWindow]);

  useEffect(() => {
    setSelectedId((current) => {
      if (current && users.some((user) => user.id === current)) return current;
      return users[0]?.id ?? null;
    });
  }, [users]);

  const visibleUsers = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return users;
    return users.filter(
      (user) => user.name.toLowerCase().includes(term) || user.document.includes(term),
    );
  }, [users, search]);

  const selected: SystemUser | null = visibleUsers.find((u) => u.id === selectedId) ?? null;

  async function toggleActive() {
    if (!selected) return;
    try {
      await updateUser(selected.id, { active: !selected.active });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao atualizar usuário.");
    }
  }

  async function handleCreateSubmit(values: UserFormValues) {
    try {
      await createUser({
        email: values.email,
        password: values.password,
        name: values.name,
        document: values.document,
        operatorCode: values.operatorCode,
        roleId: values.roleId || null,
      });
      setModal("none");
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao criar usuário.");
    }
  }

  async function handleEditSubmit(values: UserFormValues) {
    if (!selected) return;
    try {
      await updateUser(selected.id, {
        name: values.name,
        document: values.document,
        operatorCode: values.operatorCode,
        roleId: values.roleId || null,
      });
      setModal("none");
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao editar usuário.");
    }
  }

  async function handleResetPasswordSubmit(newPassword: string) {
    if (!selected) return;
    try {
      await resetPassword(selected.id, newPassword);
      setModal("none");
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao resetar senha.");
    }
  }

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  if (!canManageUsers) {
    return (
      <AppShell navItems={navItems} secondaryText="Usuarios e Operadores" contentTone="blue" fillViewport>
        <p style={{ color: "var(--white)", padding: 24 }}>
          Você não tem permissão para gerenciar usuários.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Usuarios e Operadores" contentTone="blue" fillViewport>
      <RegistryLayout>
        <RegistryActions
          title="Cadastrar um novo usuário"
          actions={[
            { id: "novo", label: "Novo usuario", onClick: () => setModal("new") },
            { id: "editar", label: "Editar", disabled: !selected, onClick: () => setModal("edit") },
            {
              id: "resetar-senha",
              label: "Resetar senha",
              disabled: !selected,
              onClick: () => setModal("reset-password"),
            },
            {
              id: "permissoes",
              label: "Permissões",
              onClick: () => navigate("/permissoes"),
            },
          ]}
        />

        <RegistryTable
          columns={COLUNAS}
          rows={visibleUsers}
          getRowId={(user) => user.id}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <RegistryDetails
          searchLabel="Buscar Usuario"
          search={search}
          onSearchChange={setSearch}
          status={{
            active: Boolean(selected?.active),
            disabled: !selected,
            onToggle: toggleActive,
          }}
          fields={[
            { label: "Email", value: selected?.email },
            { label: "Papel de acesso", value: selected?.roleName ?? "Sem papel" },
          ]}
          media={{ label: "Foto", layout: "stacked" }}
        />
      </RegistryLayout>

      {(error || actionError) && (
        <p style={{ color: "var(--amber)", padding: "0 24px" }}>{error ?? actionError}</p>
      )}

      {modal === "new" && (
        <UserFormModal
          mode="create"
          title="Novo usuário"
          roles={roles}
          onSubmit={handleCreateSubmit}
          onCancel={() => setModal("none")}
        />
      )}

      {modal === "edit" && selected && (
        <UserFormModal
          mode="edit"
          title="Editar usuário"
          roles={roles}
          initialValues={{
            email: selected.email,
            name: selected.name,
            document: selected.document,
            operatorCode: selected.operatorCode,
            roleId: selected.roleId ?? "",
          }}
          onSubmit={handleEditSubmit}
          onCancel={() => setModal("none")}
        />
      )}

      {modal === "reset-password" && selected && (
        <ResetPasswordModal
          userName={selected.name}
          onSubmit={handleResetPasswordSubmit}
          onCancel={() => setModal("none")}
        />
      )}
    </AppShell>
  );
}
