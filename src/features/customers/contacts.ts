export type ContactKind = "clientes" | "fornecedores";

export type Contact = {
  id: string;
  code: string;
  name: string;
  document: string;
  active: boolean;
  isFavorite: boolean;
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
  /**
   * CRT do contato (`contacts.regime_tributario`): `"1"`/`"2"`/`"4"` para
   * optantes pelo Simples Nacional (o `4` é o MEI), `"3"` para Regime Normal.
   * Vazio/ausente é "não informado", e é caso legítimo.
   *
   * Não é o CRT que vai na nota — esse é o da filial emitente. Serve à
   * elegibilidade do destinatário ao crédito de ICMS do art. 23 da LC
   * 123/2006: o optante não faz jus a ele, e uma NF-e com CSOSN 101/201 para
   * esse cliente é recusada pelo motor fiscal. Dimensão diferente de
   * `indicadorIe`, que diz se o cliente tem inscrição estadual.
   */
  regimeTributario?: string;
  codigoIbgeMunicipio?: string;
};

/** Endereço em uma linha só (logradouro, número - bairro, município/UF), para telas que só mostram texto (ex.: snapshot de venda). */
export function formatContactAddress(contact: Pick<Contact, "logradouro" | "numero" | "bairro" | "municipio" | "uf">): string {
  const rua = [contact.logradouro, contact.numero].filter(Boolean).join(", ");
  const linha1 = [rua, contact.bairro].filter(Boolean).join(" - ");
  const cidade = [contact.municipio, contact.uf].filter(Boolean).join("/");
  return [linha1, cidade].filter(Boolean).join(", ");
}

