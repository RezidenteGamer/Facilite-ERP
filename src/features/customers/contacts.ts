export type ContactKind = "clientes" | "fornecedores";

export type Contact = {
  id: string;
  code: string;
  name: string;
  document: string;
  active: boolean;
  address?: string;
  rg?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  createdAt?: string;
};

/** Quantas linhas a tabela mostra mesmo com poucos cadastros. */
export const MIN_TABLE_ROWS = 7;

/**
 * Dados de exemplo — sem back-end ainda. Trocar por uma busca real
 * (Supabase) quando o cadastro existir; a tela só depende deste formato.
 */
export const CONTACTS: Record<ContactKind, Contact[]> = {
  clientes: [
    {
      id: "cli-001",
      code: "001",
      name: "Bruno venzo debacco",
      document: "14113471967",
      active: true,
    },
  ],
  fornecedores: [],
};
