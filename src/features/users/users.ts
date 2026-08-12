export type SystemUser = {
  id: string;
  code: string;
  name: string;
  document: string;
  operatorCode: string;
  active: boolean;
  email?: string;
  createdAt?: string;
};

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const SYSTEM_USERS: SystemUser[] = [
  {
    id: "user-001",
    code: "",
    name: "Bruno venzo debacco",
    document: "14113471967",
    operatorCode: "01",
    active: true,
  },
  {
    id: "user-002",
    code: "",
    name: "Igor Candido",
    document: "1234567890",
    operatorCode: "02",
    active: true,
  },
];
