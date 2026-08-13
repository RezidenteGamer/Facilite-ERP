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
};
