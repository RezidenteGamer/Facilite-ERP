import { describe, expect, it } from "vitest";
import { canAssignRole } from "../../supabase/functions/admin-users/roleAssignment.ts";

describe("atribuição de papel usada por admin-users após o gate can_manage_users", () => {
  const caller = { organizationId: "A", roleId: "gestor", canManagePermissions: false };
  it("permite remover o papel", () => expect(canAssignRole(caller, null, null)).toBe(true));
  it("permite o próprio papel", () => expect(canAssignRole(caller, "gestor", { id: "gestor", organizationId: "A" })).toBe(true));
  it.each(["Administrador", "Operador", "outro-sem-flags"])("recusa %s sem ordenar privilégios", (id) => {
    expect(canAssignRole(caller, id, { id, organizationId: "A" })).toBe(false);
  });
  it.each([false, true])("recusa papel estrangeiro mesmo com canManagePermissions=%s", (canManagePermissions) => {
    expect(canAssignRole({ ...caller, canManagePermissions }, "estrangeiro", { id: "estrangeiro", organizationId: "B" })).toBe(false);
  });
  it("gestor de permissões atribui qualquer papel local", () => {
    expect(canAssignRole({ ...caller, canManagePermissions: true }, "Administrador", { id: "Administrador", organizationId: "A" })).toBe(true);
  });
  it("recusa papel inexistente", () => expect(canAssignRole(caller, "gestor", null)).toBe(false));
  it("recusa id diferente do que foi resolvido no servidor", () => {
    expect(canAssignRole({ ...caller, canManagePermissions: true }, "alvo", { id: "outro", organizationId: "A" })).toBe(false);
  });
});
