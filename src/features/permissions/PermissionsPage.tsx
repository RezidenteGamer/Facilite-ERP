import * as Dialog from "@radix-ui/react-dialog";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AppShell, { type HeaderNavItem } from "../../components/AppShell";
import { BuildingIcon, GearIcon, HeadsetIcon, HouseIcon } from "../../components/icons";
import FormField from "../../components/form/FormField";
import { useAuth } from "../auth/AuthContext";
import "../registry-engine/RegistryFormModal.css";
import { usePermissionsData, type PermissionAction } from "./usePermissionsData";
import "./PermissionsPage.css";

const ACTIONS: { id: PermissionAction; label: string }[] = [
  { id: "view", label: "Ver" },
  { id: "create", label: "Criar" },
  { id: "edit", label: "Editar" },
  { id: "delete", label: "Excluir" },
];

function NewRoleModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, description: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  function handleSubmit() {
    if (!name.trim()) {
      setError("Informe um nome para o papel.");
      return;
    }
    setError("");
    onSubmit(name.trim(), description.trim());
  }

  return (
    <Dialog.Root open onOpenChange={(open) => !open && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="registry-form-modal__overlay">
          <Dialog.Content className="registry-form-modal" aria-describedby={undefined}>
            <Dialog.Title className="registry-form-modal__title" asChild>
              <p>Novo papel de acesso</p>
            </Dialog.Title>

            {error && <p className="registry-form-modal__error">{error}</p>}

            <div className="registry-form-modal__fields">
              <FormField id="new-role-name" label="Nome *" value={name} onChange={setName} />
              <FormField
                id="new-role-description"
                label="Descrição"
                value={description}
                onChange={setDescription}
              />
            </div>

            <div className="registry-form-modal__actions">
              <button
                className="registry-form-modal__btn registry-form-modal__btn--cancel"
                type="button"
                onClick={onCancel}
              >
                Cancelar
              </button>
              <button
                className="registry-form-modal__btn registry-form-modal__btn--confirm"
                type="button"
                onClick={handleSubmit}
              >
                Criar
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Overlay>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Tela de administração de permissões: grade papel × módulo (ver/criar/editar/excluir). */
export default function PermissionsPage() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const { roles, modules, error, cellFor, setPermission, setRoleCapability, createRole } =
    usePermissionsData();

  const [actionError, setActionError] = useState<string | null>(null);
  const [showNewRole, setShowNewRole] = useState(false);

  const canManagePermissions = Boolean(profile?.canManagePermissions);

  const navItems: HeaderNavItem[] = [
    { id: "inicio", label: "Inicio", icon: HouseIcon, onClick: () => navigate("/inicio") },
    { id: "filiais", label: "Filiais", icon: BuildingIcon },
    { id: "suporte", label: "Suporte", icon: HeadsetIcon },
    { id: "configuracoes", label: "Configurações", icon: GearIcon, onClick: () => navigate("/configuracoes") },
  ];

  async function handleTogglePermission(roleId: string, moduleId: string, action: PermissionAction, value: boolean) {
    try {
      await setPermission(roleId, moduleId, action, value);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao salvar permissão.");
    }
  }

  async function handleToggleCapability(
    roleId: string,
    field: "canManagePermissions" | "canManageUsers",
    value: boolean,
  ) {
    try {
      await setRoleCapability(roleId, field, value);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao salvar permissão.");
    }
  }

  async function handleCreateRole(name: string, description: string) {
    try {
      await createRole(name, description);
      setShowNewRole(false);
      setActionError(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao criar papel.");
    }
  }

  if (!canManagePermissions) {
    return (
      <AppShell navItems={navItems} secondaryText="Permissões">
        <p style={{ color: "var(--white)", padding: 24 }}>
          Você não tem permissão para gerenciar permissões.
        </p>
      </AppShell>
    );
  }

  return (
    <AppShell navItems={navItems} secondaryText="Permissões">
      <div className="permissions-page">
        <div className="permissions-page__header">
          <h1 className="permissions-page__title">Permissões por papel de acesso</h1>
          <button
            className="permissions-page__new-role-btn"
            type="button"
            onClick={() => setShowNewRole(true)}
          >
            Novo papel
          </button>
        </div>

        {(error || actionError) && (
          <p className="permissions-page__error">{error ?? actionError}</p>
        )}

        <div className="permissions-page__table-wrap">
          <table className="permissions-table">
            <thead>
              <tr>
                <th rowSpan={2}>Papel</th>
                {modules.map((module) => (
                  <th key={module.id} colSpan={4}>
                    {module.label}
                  </th>
                ))}
                <th rowSpan={2}>Gerenciar permissões</th>
                <th rowSpan={2}>Gerenciar usuários</th>
              </tr>
              <tr>
                {modules.map((module) =>
                  ACTIONS.map((action) => (
                    <th key={`${module.id}-${action.id}`} className="permissions-table__action-header">
                      {action.label}
                    </th>
                  )),
                )}
              </tr>
            </thead>
            <tbody>
              {roles.map((role) => (
                <tr key={role.id}>
                  <td className="permissions-table__role-name">{role.name}</td>
                  {modules.map((module) => {
                    const cell = cellFor(role.id, module.id);
                    const cellValue: Record<PermissionAction, boolean> = {
                      view: cell.canView,
                      create: cell.canCreate,
                      edit: cell.canEdit,
                      delete: cell.canDelete,
                    };
                    return ACTIONS.map((action) => (
                      <td key={`${role.id}-${module.id}-${action.id}`} className="permissions-table__checkbox-cell">
                        <input
                          type="checkbox"
                          checked={cellValue[action.id]}
                          onChange={(event) =>
                            handleTogglePermission(role.id, module.id, action.id, event.target.checked)
                          }
                        />
                      </td>
                    ));
                  })}
                  <td className="permissions-table__checkbox-cell">
                    <input
                      type="checkbox"
                      checked={role.canManagePermissions}
                      onChange={(event) =>
                        handleToggleCapability(role.id, "canManagePermissions", event.target.checked)
                      }
                    />
                  </td>
                  <td className="permissions-table__checkbox-cell">
                    <input
                      type="checkbox"
                      checked={role.canManageUsers}
                      onChange={(event) =>
                        handleToggleCapability(role.id, "canManageUsers", event.target.checked)
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNewRole && (
        <NewRoleModal onSubmit={handleCreateRole} onCancel={() => setShowNewRole(false)} />
      )}
    </AppShell>
  );
}
