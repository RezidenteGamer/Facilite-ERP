export type SystemUser = {
  id: string;
  code: string;
  name: string;
  document: string;
  operatorCode: string;
  active: boolean;
  email: string;
  roleId: string | null;
  roleName: string | null;
  createdAt?: string;
};

export type Role = {
  id: string;
  name: string;
  description: string | null;
  canManagePermissions: boolean;
  canManageUsers: boolean;
  /** Teto de desconto (%) que o papel pode aplicar numa venda/pedido — nulo = sem teto (tarefa C3, 29/08/2026). */
  maxDiscountPercent: number | null;
};
