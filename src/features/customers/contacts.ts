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

