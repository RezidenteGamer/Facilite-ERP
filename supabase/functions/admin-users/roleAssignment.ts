export type AssignmentCaller = {
  organizationId: string;
  roleId: string;
  canManagePermissions: boolean;
};

export type AssignmentRole = { id: string; organizationId: string };

/** Só recebe dados resolvidos pelo servidor, após o gate can_manage_users. */
export function canAssignRole(
  caller: AssignmentCaller,
  requestedRoleId: string | null,
  requestedRole: AssignmentRole | null,
): boolean {
  if (requestedRoleId === null) return true;
  if (!requestedRole || requestedRole.id !== requestedRoleId ||
    requestedRole.organizationId !== caller.organizationId) return false;
  return caller.canManagePermissions || requestedRoleId === caller.roleId;
}
