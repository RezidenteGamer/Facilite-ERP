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
  const { roles, modules, error, cellFor, setPermission, setRoleCapability, setRoleMaxDiscount, createRole } =
    usePermissionsData();

  const [actionError, setActionError] = useState<string | null>(null);
  const [showNewRole, setShowNewRole] = useState(false);
  /** Rascunho de texto por papel — permite digitar livremente antes de salvar no blur. */
  const [discountDrafts, setDiscountDrafts] = useState<Record<string, string>>({});
  /** Feedback visual de "salvando.../salvo" por papel — sem isso, um campo de
   * texto não tem como o usuário perceber que a gravação aconteceu (diferente
   * de um checkbox, que continua marcado sozinho). "saved" some sozinho. */
  const [discountStatus, setDiscountStatus] = useState<Record<string, "saving" | "saved">>({});

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

  /** Vazio = sem teto (null). Erro de validação/banco aparece no lugar do campo, não trava a digitação. */
  async function handleCommitMaxDiscount(roleId: string) {
    const draft = discountDrafts[roleId];
    if (draft === undefined) return;

    const trimmed = draft.trim();
    const value = trimmed === "" ? null : Number(trimmed.replace(",", "."));
    if (value !== null && Number.isNaN(value)) {
      setActionError("Teto de desconto precisa ser um número.");
      return;
    }

    setDiscountStatus((prev) => ({ ...prev, [roleId]: "saving" }));
    try {
      await setRoleMaxDiscount(roleId, value);
      setActionError(null);
      setDiscountDrafts((prev) => {
        const next = { ...prev };
        delete next[roleId];
        return next;
      });
      setDiscountStatus((prev) => ({ ...prev, [roleId]: "saved" }));
      window.setTimeout(() => {
        setDiscountStatus((prev) => {
          const next = { ...prev };
          delete next[roleId];
          return next;
        });
      }, 2000);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Erro ao salvar teto de desconto.");
      setDiscountStatus((prev) => {
        const next = { ...prev };
        delete next[roleId];
        return next;
      });
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
                <th rowSpan={2}>Desconto máximo</th>
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
                  <td className="permissions-table__discount-cell">
                    <div className="permissions-table__discount-row">
                      <input
                        className="permissions-table__discount-input"
                        type="text"
                        inputMode="decimal"
                        placeholder="Sem teto"
                        aria-label={`Desconto máximo — ${role.name}`}
                        title="Soma do desconto por item e do desconto de cabeçalho, sobre o valor bruto. Vazio = sem teto."
                        value={
                          discountDrafts[role.id] ??
                          (role.maxDiscountPercent === null ? "" : String(role.maxDiscountPercent))
                        }
                        onChange={(event) =>
                          setDiscountDrafts((prev) => ({ ...prev, [role.id]: event.target.value }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") handleCommitMaxDiscount(role.id);
                        }}
                      />
                      {/* Só aparece quando há algo digitado ainda não salvo — clicar fora
                          do campo NÃO salva mais nada sozinho, de propósito: o usuário
                          pediu uma confirmação explícita, não uma gravação silenciosa. */}
                      {discountDrafts[role.id] !== undefined && (
                        <button
                          className="permissions-table__discount-save"
                          type="button"
                          disabled={discountStatus[role.id] === "saving"}
                          onClick={() => handleCommitMaxDiscount(role.id)}
                        >
                          Salvar
                        </button>
                      )}
                    </div>
                    <span className="permissions-table__discount-status" aria-live="polite">
                      {discountStatus[role.id] === "saving" && "Salvando…"}
                      {discountStatus[role.id] === "saved" && "✓ Salvo"}
                    </span>
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
