export type ContactKind = "clientes" | "fornecedores";

export type Contact = {
  id: string;
  code: string;
  name: string;
  document: string;
  active: boolean;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  cep?: string;
  rg?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  whatsapp?: string;
  createdAt?: string;
  photoUrl?: string;
  inscricaoEstadual?: string;
  indicadorIe?: string;
  codigoIbgeMunicipio?: string;
};

/** Endereço em uma linha só (logradouro, número - bairro, município/UF), para telas que só mostram texto (ex.: snapshot de venda). */
export function formatContactAddress(contact: Pick<Contact, "logradouro" | "numero" | "bairro" | "municipio" | "uf">): string {
  const rua = [contact.logradouro, contact.numero].filter(Boolean).join(", ");
  const linha1 = [rua, contact.bairro].filter(Boolean).join(" - ");
  const cidade = [contact.municipio, contact.uf].filter(Boolean).join("/");
  return [linha1, cidade].filter(Boolean).join(", ");
}

